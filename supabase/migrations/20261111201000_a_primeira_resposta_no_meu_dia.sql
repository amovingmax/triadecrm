-- =====================================================================
-- A primeira resposta aparece e é cobrada no Meu dia — só na Imova
-- (11/11/2026)
--
-- O gargalo, nos números da Imova de 11/11/2026: o cliente espera em média
-- 73 min pela primeira resposta no expediente e 10 h fora dele; 4 de 23
-- conversas nunca foram respondidas e 3 esperam há mais de 24 h. "Ninguém é
-- cobrado por ela." O pedido: "Uma meta de 'primeira resposta' no Meu dia."
--
-- O QUE ENTRA:
--   1. A régua, em `app_settings['primeira_resposta']`: alvo de 15 min, a
--      gestão entra aos 60 min, expediente das 8h às 18h. É a MESMA chave e o
--      MESMO leitor (`app.primeira_resposta_config`) da "espera em degraus"
--      (os avisos no celular aos 15 e aos 60 min), que nasce numa migração de
--      data anterior: por isso o leitor e `app.minutos_no_expediente` só são
--      criados aqui se ainda não existirem.
--   2. `app.minutos_no_expediente(de, ate)`: quantos minutos do intervalo caem
--      no expediente (dia útil por `app.eh_dia_util`, entre o início e o fim da
--      régua, no fuso de Fortaleza). Mensagem às 22h de sexta respondida às
--      8h10 de segunda conta 10 min, e não 58 h: a régua cobra o tempo em que
--      havia alguém para responder.
--   3. As duas leituras da espera, só para as funções do banco:
--        app.primeira_resposta_esperando()   quem espera agora, desde quando;
--        app.primeira_resposta_respondidas(de, ate)  cada espera respondida no
--          intervalo, com o tempo da primeira resposta no expediente.
--   4. A leitura da tela, `public.meu_dia_primeira_resposta(p_pessoa, p_dia)`:
--      o bloco "Primeira resposta" do Meu dia novo (esperando agora; hoje, a
--      mediana e quantas em até 15 min) e, para admin e gestor, a versão da
--      equipe, pessoa por pessoa, mais as esperas sem responsável.
--
-- AS DEFINIÇÕES, porque nenhuma é óbvia:
--   * RESPOSTA é a do aviso "Resposta atrasada" (20261106210000): mensagem que
--     sai (`out`) pelo CRM (`origin = 'crm'`), escrita por gente ou pela IA que
--     atende (`author_kind in ('human', 'bot_ai')`), que não é modelo e não
--     falhou. A ausência, o bom-dia e o robô de entrada não respondem ninguém;
--     o modelo mandado com a janela fechada também não (é um pedido para o
--     cliente voltar, não a resposta ao que ele perguntou).
--   * ESPERA é cada sequência de mensagens do cliente entre duas respostas. Ela
--     começa na PRIMEIRA mensagem do cliente depois da última resposta (quem
--     mandou três mensagens seguidas espera desde a primeira) e termina na
--     primeira resposta depois dela. Reação (👍) não abre espera: não é palavra.
--     A comparação é estrita, como no aviso: resposta com o mesmo carimbo da
--     mensagem não a responde.
--   * DE QUEM É: de quem atende a conversa (`conversations.assignee_id`) quando
--     essa pessoa atende (admin, gestor ou SDR ativos, `app.avisos_quem_atende`).
--     Fora disso a conversa está SEM RESPONSÁVEL e aparece para todos que
--     atendem, como no aviso (`app.avisos_destino_da_conversa(c, false)`).
--     Silenciar a conversa vale para o aviso, não para a cobrança.
--   * FICA DE FORA: a conversa do treino e as de teste da IA (20261110150000);
--     de "esperando agora", também a concluída, a bloqueada e quem pediu para
--     sair (`app.wa_motivo_de_recusa`), porque nelas não há o que responder.
--
-- POR QUE NÃO É A RÉGUA DO RELATÓRIO. `app.imova_primeiras_respostas`
-- (20261109210000) mede uma vez por conversa de CLIENTE NOVA, da primeira
-- mensagem da vida da conversa à primeira saída de gente ou da IA, em minutos
-- de relógio, e deixa de fora quem nunca foi respondido. Para cobrar a pessoa
-- no dia, isso não serve: o cliente antigo que volta a escrever também espera,
-- a madrugada não é atraso de ninguém, e quem não foi respondido é exatamente
-- quem precisa aparecer. Por isso aqui a régua é por ESPERA, em minutos de
-- EXPEDIENTE, e quem não foi respondido mora em "Esperando agora". Os dois
-- números não batem de propósito; a tela diz como este é contado.
--
-- O WHATSAPP NÃO É TOCADO: nada aqui grava mensagem, conversa ou fila. Só
-- leitura (e a chave da régua em `app_settings`).
--
-- SÓ DA IMOVA: no banco da KOMUNE nada é criado; e a leitura da tela recusa
-- se a identidade for a da KOMUNE (num banco sem identidade, CI, tudo é
-- criado para os testes).
--
-- COMO DESFAZER (no banco da Imova): drop das funções
-- public.meu_dia_primeira_resposta(uuid, date),
-- app.primeira_resposta_respondidas(timestamptz, timestamptz) e
-- app.primeira_resposta_esperando(). A chave `primeira_resposta`, o leitor e
-- `app.minutos_no_expediente` ficam: são da "espera em degraus" também.
-- =====================================================================

do $primeira$
begin
  if (select i.empresa from app.identidade i) = 'komune' then
    raise notice 'A primeira resposta no Meu dia é só da Imova: no banco da KOMUNE nada foi criado.';
    return;
  end if;

  -- -------------------------------------------------------------------
  -- 1. A régua (a mesma da "espera em degraus")
  -- -------------------------------------------------------------------
  insert into public.app_settings (key, value, description)
  values ('primeira_resposta',
          '{"alvo_min": 15, "gestao_min": 60, "expediente_inicio": "08:00", "expediente_fim": "18:00"}'::jsonb,
          'A primeira resposta ao cliente (11/11/2026): o alvo em minutos de expediente, quando a gestão entra, e o expediente que conta (dias úteis, fuso de Fortaleza).')
  on conflict (key) do nothing;

  if to_regprocedure('app.primeira_resposta_config()') is null then
    execute $f$
create or replace function app.primeira_resposta_config() returns jsonb
language sql stable security definer set search_path = '' as $$
  select '{"alvo_min": 15, "gestao_min": 60, "expediente_inicio": "08:00", "expediente_fim": "18:00"}'::jsonb
         || coalesce((select s.value from public.app_settings s where s.key = 'primeira_resposta'), '{}'::jsonb)
$$;
    $f$;
    execute $f$
comment on function app.primeira_resposta_config() is
  'A régua da primeira resposta ao cliente (app_settings primeira_resposta) sobre os valores padrão: alvo_min 15, gestao_min 60, expediente das 08:00 às 18:00. Imova, 11/11/2026.';
    $f$;
  end if;

  if to_regprocedure('app.minutos_no_expediente(timestamp with time zone,timestamp with time zone)') is null then
    execute $f$
create or replace function app.minutos_no_expediente(p_de timestamptz, p_ate timestamptz)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  -- Um dia de calendário de Fortaleza por linha, de p_de a p_ate; de cada dia
  -- útil, o pedaço do intervalo que cai entre o início e o fim do expediente.
  -- Intervalo vazio, invertido ou infinito: nenhum dia, zero.
  with cfg as (
    select case when c ->> 'expediente_inicio' ~ '^([01]?[0-9]|2[0-3]):[0-5][0-9]$'
                then (c ->> 'expediente_inicio')::time else time '08:00' end as ini,
           case when c ->> 'expediente_fim' ~ '^([01]?[0-9]|2[0-3]):[0-5][0-9]$'
                then (c ->> 'expediente_fim')::time else time '18:00' end as fim
      from (select app.primeira_resposta_config() as c) x
  ),
  dias as (
    select g::date as dia
      from generate_series(
             case when p_ate > p_de and isfinite(p_de) and isfinite(p_ate)
                  then (p_de at time zone 'America/Fortaleza')::date::timestamp end,
             (p_ate at time zone 'America/Fortaleza')::date::timestamp,
             interval '1 day') as g
  )
  select coalesce(round(sum(greatest(0::numeric,
           extract(epoch from least(p_ate, (d.dia + cfg.fim) at time zone 'America/Fortaleza')
                            - greatest(p_de, (d.dia + cfg.ini) at time zone 'America/Fortaleza')) / 60)), 2), 0)
    from dias d
    cross join cfg
   where app.eh_dia_util(d.dia)
$$;
    $f$;
    execute $f$
comment on function app.minutos_no_expediente(timestamptz, timestamptz) is
  'Quantos minutos do intervalo [p_de, p_ate) caem no expediente: dia útil (app.eh_dia_util), entre expediente_inicio e expediente_fim de app.primeira_resposta_config(), no fuso de Fortaleza. p_ate <= p_de dá 0. Sexta 22h a segunda 8h10 dá 10. Imova, 11/11/2026.';
    $f$;
  end if;

  revoke all on function app.primeira_resposta_config() from public, anon, authenticated;
  revoke all on function app.minutos_no_expediente(timestamptz, timestamptz) from public, anon, authenticated;

  execute $ddl$

-- =====================================================================
-- 2. Quem espera agora
-- =====================================================================
-- Uma linha por conversa em que a última palavra é do cliente e ninguém do time
-- respondeu depois: desde quando (a primeira mensagem dele depois da última
-- resposta) e de quem é (nulo = sem responsável).
create or replace function app.primeira_resposta_esperando()
returns table (conversation_id uuid, dono uuid, desde timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  with atende as (select q.id from app.avisos_quem_atende() as q (id)),
  fora as (
    select array_remove(app.ia_conversas_de_teste() || app.ia_conversa_de_treino(), null) as ids
  )
  select c.id,
         case when c.assignee_id in (select a.id from atende a) then c.assignee_id end,
         e.desde
    from public.conversations c
    cross join fora f
    -- A última resposta (pelo índice da conversa, do fim para o começo).
    left join lateral (
      select max(m.created_at) as em
        from public.messages m
       where m.conversation_id = c.id
         and m.direction = 'out'::app.msg_direction and m.origin = 'crm'
         and m.author_kind in ('human', 'bot_ai')
         and m.type <> 'template'::app.msg_type and m.status <> 'failed'::app.msg_status
    ) r on true
    -- A primeira mensagem do cliente desde então. Com o mesmo carimbo da
    -- resposta, ainda espera: a resposta só responde o que veio antes dela.
    cross join lateral (
      select min(m.created_at) as desde
        from public.messages m
       where m.conversation_id = c.id
         and m.direction = 'in'::app.msg_direction
         and m.type <> 'reaction'::app.msg_type
         and m.created_at >= coalesce(r.em, '-infinity'::timestamptz)
    ) e
   where c.last_inbound_at is not null
     and e.desde is not null
     and c.arquivada_em is null
     and c.bloqueada_em is null
     and c.id <> all (f.ids)
     and app.wa_motivo_de_recusa(c.organization_id, c.contact_id, c.peer_phone_e164) is null
$$;
comment on function app.primeira_resposta_esperando() is
  'As conversas que esperam a resposta do time agora (Imova, 11/11/2026): a última palavra é do cliente e nenhuma resposta (out, origin crm, human ou bot_ai, não modelo, não falhou) veio depois. desde = a primeira mensagem do cliente depois da última resposta (reação não conta). dono = quem atende, se atende (app.avisos_quem_atende); nulo = sem responsável. Fora: treino e teste da IA, concluída, bloqueada e quem pediu para sair.';
revoke all on function app.primeira_resposta_esperando() from public, anon, authenticated;

-- =====================================================================
-- 3. Cada espera respondida num intervalo
-- =====================================================================
-- Uma linha por resposta que encerrou uma espera: a primeira resposta depois
-- de uma ou mais mensagens do cliente. `minutos` é o tempo no expediente, da
-- primeira mensagem da espera à resposta. A espera pode ter começado antes do
-- intervalo (quem responde hoje o cliente de ontem leva o atraso de ontem).
create or replace function app.primeira_resposta_respondidas(p_de timestamptz, p_ate timestamptz)
returns table (conversation_id uuid, dono uuid, desde timestamptz, respondida_em timestamptz,
               minutos numeric, por_quem uuid, pela_ia boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with atende as (select q.id from app.avisos_quem_atende() as q (id)),
  fora as (
    select array_remove(app.ia_conversas_de_teste() || app.ia_conversa_de_treino(), null) as ids
  ),
  resp as (
    select c.id as conversation_id,
           case when c.assignee_id in (select a.id from atende a) then c.assignee_id end as dono,
           m.created_at, m.sent_by, m.author_kind
      from public.conversations c
      cross join fora f
      join public.messages m
        on m.conversation_id = c.id
       and m.created_at >= p_de and m.created_at < p_ate
       and m.direction = 'out'::app.msg_direction and m.origin = 'crm'
       and m.author_kind in ('human', 'bot_ai')
       and m.type <> 'template'::app.msg_type and m.status <> 'failed'::app.msg_status
     where c.last_inbound_at is not null
       and c.id <> all (f.ids)
  ),
  com_espera as (
    select r.*, e.desde
      from resp r
      -- A resposta anterior a esta, na mesma conversa.
      cross join lateral (
        select max(m.created_at) as em
          from public.messages m
         where m.conversation_id = r.conversation_id
           and m.created_at < r.created_at
           and m.direction = 'out'::app.msg_direction and m.origin = 'crm'
           and m.author_kind in ('human', 'bot_ai')
           and m.type <> 'template'::app.msg_type and m.status <> 'failed'::app.msg_status
      ) a
      -- A primeira mensagem do cliente entre as duas: sem ela, esta resposta
      -- não abriu nem fechou espera nenhuma (era a segunda fala seguida).
      cross join lateral (
        select min(m.created_at) as desde
          from public.messages m
         where m.conversation_id = r.conversation_id
           and m.direction = 'in'::app.msg_direction
           and m.type <> 'reaction'::app.msg_type
           and m.created_at >= coalesce(a.em, '-infinity'::timestamptz)
           and m.created_at < r.created_at
      ) e
     where e.desde is not null
  )
  -- Duas respostas com o mesmo carimbo fechariam a mesma espera duas vezes.
  select distinct on (w.conversation_id, w.desde)
         w.conversation_id, w.dono, w.desde, w.created_at,
         app.minutos_no_expediente(w.desde, w.created_at),
         w.sent_by, w.author_kind = 'bot_ai'
    from com_espera w
   order by w.conversation_id, w.desde, w.created_at
$$;
comment on function app.primeira_resposta_respondidas(timestamptz, timestamptz) is
  'Cada espera do cliente respondida em [p_de, p_ate) (Imova, 11/11/2026): desde a primeira mensagem do cliente depois da resposta anterior até a primeira resposta (out, origin crm, human ou bot_ai, não modelo, não falhou), com o tempo em minutos de expediente (app.minutos_no_expediente). dono = quem atende a conversa agora, se atende; nulo = sem responsável. Fora: treino e teste da IA.';
revoke all on function app.primeira_resposta_respondidas(timestamptz, timestamptz) from public, anon, authenticated;

-- =====================================================================
-- 4. A leitura do Meu dia
-- =====================================================================
-- `p_pessoa` nulo = quem entrou. Outra pessoa, só quem a acompanha pela
-- hierarquia do Meu dia (`app.acompanha`, o espelho de `lib/auth/hierarquia.ts`).
-- `p_dia` nulo = hoje em Fortaleza; vale para as respondidas. "Esperando" é
-- sempre agora. A versão da equipe vai para admin e gestor, com quem eles
-- acompanham, e as esperas sem responsável à parte.
create or replace function public.meu_dia_primeira_resposta(p_pessoa uuid default null,
                                                           p_dia    date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := auth.uid();
  v_alvo       uuid;
  v_cfg        jsonb := app.primeira_resposta_config();
  v_alvo_min   numeric;
  v_gestao_min numeric;
  v_inicio     text;
  v_fim        text;
  v_dia        date;
  v_de         timestamptz;
  v_ate        timestamptz;
  v_atende     boolean;
  v_equipe     boolean;
begin
  if (select i.empresa from app.identidade i) = 'komune' then
    raise exception 'A primeira resposta no Meu dia é só da Imova' using errcode = '0A000';
  end if;
  if v_uid is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  v_alvo := coalesce(p_pessoa, v_uid);
  if v_alvo <> v_uid and not app.acompanha(v_alvo) then
    raise exception 'Você não acompanha o dia desta pessoa' using errcode = '42501';
  end if;

  v_dia := coalesce(p_dia, (now() at time zone 'America/Fortaleza')::date);
  v_de  := v_dia::timestamp at time zone 'America/Fortaleza';
  v_ate := (v_dia + 1)::timestamp at time zone 'America/Fortaleza';

  v_alvo_min := case when v_cfg ->> 'alvo_min' ~ '^[0-9]{1,4}(\.[0-9]+)?$'
                     then (v_cfg ->> 'alvo_min')::numeric else 15 end;
  v_gestao_min := case when v_cfg ->> 'gestao_min' ~ '^[0-9]{1,4}(\.[0-9]+)?$'
                       then (v_cfg ->> 'gestao_min')::numeric else 60 end;
  v_inicio := case when v_cfg ->> 'expediente_inicio' ~ '^([01]?[0-9]|2[0-3]):[0-5][0-9]$'
                   then v_cfg ->> 'expediente_inicio' else '08:00' end;
  v_fim := case when v_cfg ->> 'expediente_fim' ~ '^([01]?[0-9]|2[0-3]):[0-5][0-9]$'
                then v_cfg ->> 'expediente_fim' else '18:00' end;

  -- As sem responsável são de todos que atendem; de quem não atende, não.
  v_atende := exists (select 1 from app.avisos_quem_atende() as q (id) where q.id = v_alvo);
  v_equipe := app.admin_ou_gestor();

  return (
    with esp as materialized (
      select e.conversation_id, e.dono, e.desde from app.primeira_resposta_esperando() e
    ),
    resp as materialized (
      select r.conversation_id, r.dono, r.minutos
        from app.primeira_resposta_respondidas(v_de, v_ate) r
    ),
    minhas_esp as (
      select e.* from esp e where e.dono = v_alvo or (e.dono is null and v_atende)
    ),
    minhas_resp as (
      select r.* from resp r where r.dono = v_alvo or (r.dono is null and v_atende)
    ),
    -- Quem entra na versão da equipe: quem olha e quem ele acompanha.
    gente as (
      select t.id, coalesce(nullif(btrim(t.full_name), ''), 'Sem nome') as nome,
             t.role::text as papel, 0 as ordem
        from public.team_directory t
       where v_equipe and t.id = v_uid
      union all
      select t.id, coalesce(nullif(btrim(t.full_name), ''), 'Sem nome'), t.role::text, 1
        from public.team_directory t
       where v_equipe and t.id <> v_uid and t.is_active and app.acompanha(t.id)
    ),
    linhas as (
      select g.id, g.nome, g.papel, g.ordem,
             (select count(*) from esp e where e.dono = g.id) as esperando,
             (select min(e.desde) from esp e where e.dono = g.id) as mais_antiga,
             (select count(*) from resp r where r.dono = g.id) as respondidas,
             (select count(*) from resp r where r.dono = g.id and r.minutos <= v_alvo_min) as no_alvo,
             (select round((percentile_cont(0.5) within group (order by r.minutos))::numeric, 1)
                from resp r where r.dono = g.id) as mediana
        from gente g
    ),
    da_equipe_esp as (
      select e.* from esp e where e.dono is null or e.dono in (select g.id from gente g)
    ),
    da_equipe_resp as (
      select r.* from resp r where r.dono is null or r.dono in (select g.id from gente g)
    )
    select jsonb_build_object(
      'regua', jsonb_build_object('alvo_min', v_alvo_min, 'gestao_min', v_gestao_min,
                                  'expediente_inicio', v_inicio, 'expediente_fim', v_fim),
      'dia', v_dia,
      'agora', now(),
      'pessoa', jsonb_build_object(
        'id', v_alvo,
        'esperando', (select count(*) from minhas_esp),
        'sem_responsavel', (select count(*) from minhas_esp e where e.dono is null),
        'itens', coalesce((
          select jsonb_agg(jsonb_build_object(
                   'conversation_id', x.conversation_id,
                   'nome', app.nome_da_conversa(x.conversation_id),
                   'caminho', app.caminho_da_conversa(x.conversation_id),
                   'desde', x.desde,
                   'minutos', app.minutos_no_expediente(x.desde, now()),
                   'sem_responsavel', x.dono is null)
                 order by x.desde, x.conversation_id)
            from (select e.* from minhas_esp e order by e.desde, e.conversation_id limit 20) x),
          '[]'::jsonb),
        'respondidas', (select count(*) from minhas_resp),
        'no_alvo', (select count(*) from minhas_resp r where r.minutos <= v_alvo_min),
        'mediana_min', (select round((percentile_cont(0.5) within group (order by r.minutos))::numeric, 1)
                          from minhas_resp r)),
      'equipe', case when v_equipe then jsonb_build_object(
        'pessoas', coalesce((
          select jsonb_agg(jsonb_build_object(
                   'id', l.id, 'nome', l.nome, 'papel', l.papel,
                   'esperando', l.esperando, 'mais_antiga', l.mais_antiga,
                   'mais_antiga_min', case when l.mais_antiga is not null
                                           then app.minutos_no_expediente(l.mais_antiga, now()) end,
                   'respondidas', l.respondidas, 'no_alvo', l.no_alvo, 'mediana_min', l.mediana)
                 order by l.ordem, l.esperando desc, l.nome)
            from linhas l), '[]'::jsonb),
        'sem_responsavel', jsonb_build_object(
          'esperando', (select count(*) from esp e where e.dono is null),
          'mais_antiga', (select min(e.desde) from esp e where e.dono is null),
          'mais_antiga_min', (select app.minutos_no_expediente(min(e.desde), now())
                                from esp e where e.dono is null having count(*) > 0),
          'respondidas', (select count(*) from resp r where r.dono is null),
          'no_alvo', (select count(*) from resp r where r.dono is null and r.minutos <= v_alvo_min),
          'mediana_min', (select round((percentile_cont(0.5) within group (order by r.minutos))::numeric, 1)
                            from resp r where r.dono is null)),
        'total', jsonb_build_object(
          'esperando', (select count(*) from da_equipe_esp),
          'mais_antiga', (select min(e.desde) from da_equipe_esp e),
          'mais_antiga_min', (select app.minutos_no_expediente(min(e.desde), now())
                                from da_equipe_esp e having count(*) > 0),
          'respondidas', (select count(*) from da_equipe_resp),
          'no_alvo', (select count(*) from da_equipe_resp r where r.minutos <= v_alvo_min),
          'mediana_min', (select round((percentile_cont(0.5) within group (order by r.minutos))::numeric, 1)
                            from da_equipe_resp r))
      ) end)
  );
end $$;
comment on function public.meu_dia_primeira_resposta(uuid, date) is
  'O bloco "Primeira resposta" do Meu dia novo da Imova (11/11/2026). pessoa: quem espera agora (as conversas dela e as sem responsável), com até 20 itens da mais antiga para a mais nova, e as esperas respondidas no dia (mediana em minutos de expediente e quantas no alvo). equipe (só admin e gestor): o mesmo por pessoa que ele acompanha, mais as sem responsável e o total. p_pessoa: quem entrou ou alguém que ele acompanha (app.acompanha); senão 42501. Recusa na KOMUNE.';
revoke all on function public.meu_dia_primeira_resposta(uuid, date) from public, anon;
grant execute on function public.meu_dia_primeira_resposta(uuid, date) to authenticated, service_role;

  $ddl$;
end $primeira$;

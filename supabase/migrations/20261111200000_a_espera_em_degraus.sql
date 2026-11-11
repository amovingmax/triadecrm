-- =====================================================================
-- A espera em degraus: o cliente sem resposta avisa quem atende aos 15 min
-- e a gestão a 1 h — só na Imova (11/11/2026)
--
-- Pedido do usuário em 11/11/2026: "Alerta em degraus: 15 min sem resposta
-- avisa quem atende; 1 h avisa a gestão."
--
-- O GARGALO. Na Imova o cliente espera em média 73 min pela primeira resposta
-- no expediente (mediana de 30 dias, 11/11/2026), e ninguém é cobrado por
-- isso: o único alerta, "Resposta atrasada" (`atrasada`, 20261106210000), só
-- sai com 24 h. Agora a espera tem dois degraus:
--
--   DEGRAU 1  `espera`         aos 15 min de expediente, pela regra do aviso de
--                              mensagem do navegador
--                              (`app.avisos_destino_da_conversa(c, true)`).
--                              "Maria Souza espera resposta há 15 min".
--   DEGRAU 2  `espera_gestao`  a 1 h de expediente, para admin e gestor ativos
--                              (o SDR não), dizendo com quem está: "Maria Souza
--                              espera resposta há 1 h · com João" ou "· sem
--                              responsável".
--
-- QUEM RECEBE O DEGRAU 1 (decisão de 11/11/2026, do agente principal, depois
-- de ver que a conversa nova nasce com o responsável padrão, o admin mais
-- antigo, e que a regra "quem atende a conversa" mandaria a primeira resposta
-- só para ele):
--   * ninguém do time escreveu ainda na conversa (a primeira resposta de
--     verdade): TODOS que atendem (admin, gestor e SDR);
--   * alguém do time já escreveu (gente ou a IA que atende; modelo e mensagem
--     que falhou não contam), a conversa tem ficha e o responsável atende: SÓ
--     o responsável;
--   * conversa sem ficha: todos, como no aviso de mensagem nova.
-- É exatamente o `p_regra_do_computador = true` de
-- `app.avisos_destino_da_conversa` (20261106210000), que não muda aqui. Quem
-- silenciou a conversa fica de fora nos dois casos.
--
-- O "Resposta atrasada" de 24 h continua como está.
--
-- ===========================================================================
-- O QUE É ESPERA (app.esperas_de_resposta)
-- ===========================================================================
-- A última palavra é do cliente e ninguém do time respondeu depois. "Respondeu"
-- é o mesmo do `atrasada`: mensagem de saída do CRM (`origin = 'crm'`), escrita
-- por gente ou pela IA que atende (`author_kind in ('human','bot_ai')`), que não
-- é modelo e não falhou.
--
-- A espera começa na PRIMEIRA mensagem do cliente depois da última resposta, e
-- não em `last_inbound_at`: o cliente que escreve "oi", "?" e "alô?" espera desde
-- o "oi", e o alerta não pode atrasar a cada mensagem nova dele. A chave do
-- aviso leva esse começo (como o `atrasada` leva `last_inbound_at`): um aviso
-- por espera e por pessoa. Reação (👍, ❤️) e a abertura do chat sem mensagem
-- (`request_welcome`) não começam espera: não pedem resposta.
--
-- Fica de fora: a conversa concluída ou arquivada, a bloqueada, a de contato
-- suprimido ou apagado (`app.wa_motivo_de_recusa`, a mesma pergunta do Meu dia)
-- e as conversas de teste da IA (`app.ia_conversas_de_teste`, 20261110150000).
-- Grupo não entra porque mora fora de `conversations` (`wa_grupos`).
--
-- A CONCLUÍDA QUE VOLTA. O caso mais comum de concluir é depois do "ok,
-- obrigado" do cliente. Se ele escreve de novo, o gatilho `messages_desarquiva`
-- traz a conversa de volta, e a espera conta da mensagem nova, não do "ok,
-- obrigado": concluir vale como resposta. O momento da conclusão vem do rastro
-- do gatilho de `conversations` no `audit_log` (a coluna volta a nulo).
--
-- ===========================================================================
-- O RELÓGIO DO EXPEDIENTE (app.minutos_no_expediente)
-- ===========================================================================
-- Só conta o minuto de dia útil (`app.eh_dia_util`: fim de semana e feriado
-- ficam fora), entre `expediente_inicio` e `expediente_fim`, em Fortaleza. A
-- mensagem que chega às 22h de sexta começa a contar na segunda às 8h, e o
-- degrau de 15 min sai às 8h15.
--
-- A configuração é `app_settings['primeira_resposta']`, a mesma do Meu dia:
--   {"alvo_min": 15, "gestao_min": 60, "expediente_inicio": "08:00",
--    "expediente_fim": "18:00"}
-- Para mudar (sem deploy), no banco da Imova:
--   update public.app_settings
--      set value = value || '{"alvo_min": 10, "gestao_min": 45}'::jsonb
--    where key = 'primeira_resposta';
-- O que faltar na chave vale o padrão de `app.primeira_resposta_config`.
--
-- ===========================================================================
-- NO CELULAR E NO COMPUTADOR, A MESMA REGRA
-- ===========================================================================
-- O celular: a rodada de 10 segundos (`app.avisos_push_rodar`) chama
-- `app.avisos_push_varrer_espera`, que põe na fila quem cruzou um degrau nos
-- últimos 15 min de expediente; a chave única impede o aviso dobrado. Cada pessoa
-- desliga cada degrau em "Avisos no celular" (`avisos_desligados`), e quem
-- silenciou a conversa fica de fora.
--
-- O computador: só o dono tem o app, e a equipe usa o CRM no navegador. O site
-- pergunta ao banco quem a regra manda avisar (`public.esperas_para_avisar`,
-- que devolve, para quem está logado, as esperas acima de cada degrau que valem
-- para ela, já sem as silenciadas e sem os degraus desligados) e mostra o
-- cartão, o som e a notificação do sistema
-- (`components/avisos/vigia-de-espera.tsx`).
--
-- ===========================================================================
-- O WHATSAPP NÃO É TOCADO
-- ===========================================================================
-- Nada aqui grava em `messages` ou `conversations` nem cria gatilho nelas: a
-- rodada só LÊ e escreve na fila de avisos (`app.push_fila`).
--
-- Na KOMUNE não muda nada: as funções da espera não são criadas, o catálogo da
-- KOMUNE não ganha os dois avisos e a rodada só chama a varredura na Imova.
--
-- COMO DESFAZER (no banco da Imova): reaplicar `push_fila_tipo_check`,
-- `app.avisos_catalogo` e `app.avisos_push_rodar` da 20261111120000; apagar as
-- linhas `espera`/`espera_gestao` de `app.push_fila` e `public.avisos_desligados`;
-- drop das funções public.esperas_para_avisar(), app.esperas_da_pessoa(uuid,
-- timestamptz), app.avisos_push_varrer_espera(timestamptz),
-- app.espera_duracao(numeric) e app.esperas_de_resposta(timestamptz). A chave
-- `primeira_resposta`, `app.primeira_resposta_config()` e
-- `app.minutos_no_expediente(timestamptz, timestamptz)` são divididas com o Meu
-- dia: só saem se ele não as usar mais.
-- =====================================================================

do $espera$
begin
  if (select i.empresa from app.identidade i) = 'komune' then
    raise notice 'A espera em degraus é só da Imova: no banco da KOMUNE as funções da espera não foram criadas.';
    return;
  end if;
  execute $ddl$

-- =====================================================================
-- 1. A configuração e o relógio do expediente (divididos com o Meu dia)
-- =====================================================================
insert into public.app_settings (key, value, description)
values ('primeira_resposta',
        '{"alvo_min": 15, "gestao_min": 60, "expediente_inicio": "08:00", "expediente_fim": "18:00"}'::jsonb,
        'A primeira resposta (11/11/2026): o alvo em minutos de expediente (alvo_min, avisa quem atende), o degrau da gestão (gestao_min, avisa admin e gestor) e o expediente que conta (dias úteis, em Fortaleza).')
on conflict (key) do nothing;

create or replace function app.primeira_resposta_config() returns jsonb
language sql stable security definer set search_path = '' as $$
  select '{"alvo_min": 15, "gestao_min": 60, "expediente_inicio": "08:00", "expediente_fim": "18:00"}'::jsonb
         || coalesce((select s.value from public.app_settings s where s.key = 'primeira_resposta'), '{}'::jsonb)
$$;
comment on function app.primeira_resposta_config() is
  'A configuração da primeira resposta (app_settings primeira_resposta) sobre os padrões: alvo_min 15, gestao_min 60, expediente das 08:00 às 18:00. Usada pela espera em degraus e pelo Meu dia (11/11/2026).';
revoke all on function app.primeira_resposta_config() from public, anon, authenticated;

-- Os minutos de [p_de, p_ate) que caem no expediente: dia útil, entre a abertura
-- e o fechamento da configuração, em Fortaleza. Um dia por linha, então vale
-- para intervalos de vários dias (o fim de semana e o feriado no meio somem).
create or replace function app.minutos_no_expediente(p_de timestamptz, p_ate timestamptz)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  with cfg as (
    select (x.c ->> 'expediente_inicio')::time as abre,
           (x.c ->> 'expediente_fim')::time    as fecha
      from (select app.primeira_resposta_config() as c) x
  ),
  dias as (
    select (p_de at time zone 'America/Fortaleza')::date + g.n as dia
      from generate_series(0, (p_ate at time zone 'America/Fortaleza')::date
                              - (p_de at time zone 'America/Fortaleza')::date) as g (n)
     where p_ate > p_de
  )
  select round(coalesce(sum(greatest(extract(epoch from
           least(p_ate, (d.dia + cfg.fecha) at time zone 'America/Fortaleza')
           - greatest(p_de, (d.dia + cfg.abre) at time zone 'America/Fortaleza')), 0)), 0) / 60, 2)
    from dias d
   cross join cfg
   where cfg.fecha > cfg.abre
     and app.eh_dia_util(d.dia)
$$;
comment on function app.minutos_no_expediente(timestamptz, timestamptz) is
  'Quantos minutos do intervalo [p_de, p_ate) caem no expediente: dia útil (app.eh_dia_util, sem fim de semana e feriado), entre expediente_inicio e expediente_fim de app.primeira_resposta_config, em Fortaleza. p_ate <= p_de devolve 0. Usada pela espera em degraus e pelo Meu dia (11/11/2026).';
revoke all on function app.minutos_no_expediente(timestamptz, timestamptz) from public, anon, authenticated;

-- =====================================================================
-- 2. As esperas abertas
-- =====================================================================
-- Uma linha por conversa em que o cliente espera, com o começo da espera e os
-- minutos de expediente até `p_agora`. Olha as conversas com mensagem do cliente
-- nos últimos 30 dias: o que espera há mais do que isso já passou de todos os
-- degraus (e o "Resposta atrasada" de 24 h já avisou).
create or replace function app.esperas_de_resposta(p_agora timestamptz default now())
returns table (conversation_id uuid, organization_id uuid, assignee_id uuid,
               desde timestamptz, minutos numeric)
language sql
stable
security definer
set search_path = ''
as $$
  with teste as materialized (
    select app.ia_conversas_de_teste() as lista
  ),
  candidatas as materialized (
    select c.id, c.organization_id, c.contact_id, c.assignee_id, c.peer_phone_e164
      from public.conversations c
     cross join teste t
     where c.last_inbound_at > p_agora - interval '30 days'
       and c.arquivada_em is null
       and c.bloqueada_em is null
       and not (c.id = any (t.lista))
  ),
  com_espera as (
    select c.*, x.desde
      from candidatas c
      -- A última resposta do time (o critério do `atrasada`).
      cross join lateral (
        select max(r.created_at) as em
          from public.messages r
         where r.conversation_id = c.id
           and r.direction = 'out'::app.msg_direction and r.origin = 'crm'
           and r.author_kind in ('human', 'bot_ai')
           and r.type <> 'template'::app.msg_type
           and r.status <> 'failed'::app.msg_status
           and r.created_at <= p_agora
      ) resp
      -- A última vez que a conversa foi concluída depois disso (o rastro do
      -- gatilho de `conversations` no audit_log). O "ok, obrigado" de antes de
      -- concluir não é espera: se o cliente volta a escrever, conta da volta.
      cross join lateral (
        select max((a.new_data ->> 'arquivada_em')::timestamptz) as em
          from public.audit_log a
         where a.table_name = 'conversations' and a.row_id = c.id::text
           and a.created_at > coalesce(resp.em, '-infinity'::timestamptz)
           and a.new_data ->> 'arquivada_em' is not null
      ) concl
      -- A primeira mensagem do cliente depois da resposta e da conclusão.
      cross join lateral (
        select min(m.created_at) as desde
          from public.messages m
         where m.conversation_id = c.id
           and m.direction = 'in'::app.msg_direction
           and m.created_at <= p_agora
           and m.type <> 'reaction'::app.msg_type
           and coalesce(m.tipo_na_meta, '') <> 'request_welcome'
           and m.created_at > greatest(coalesce(resp.em, '-infinity'::timestamptz),
                                       coalesce(concl.em, '-infinity'::timestamptz))
      ) x
  )
  select e.id, e.organization_id, e.assignee_id, e.desde,
         app.minutos_no_expediente(e.desde, p_agora)
    from com_espera e
   where e.desde is not null
     and app.wa_motivo_de_recusa(e.organization_id, e.contact_id, e.peer_phone_e164) is null
$$;
comment on function app.esperas_de_resposta(timestamptz) is
  'As conversas em que o cliente espera resposta (11/11/2026): a última palavra é dele e ninguém do time (gente ou IA que atende; modelo e mensagem que falhou não contam) respondeu depois. desde = a primeira mensagem dele depois da última resposta e da última conclusão (reação e abertura do chat não contam); minutos = minutos de expediente até p_agora. Fora: concluída/arquivada, bloqueada, suprimida ou apagada, conversa de teste da IA. Só a Imova.';
revoke all on function app.esperas_de_resposta(timestamptz) from public, anon, authenticated;

-- "15 min", "1 h", "1 h 30 min".
create or replace function app.espera_duracao(p_minutos numeric) returns text
language sql
immutable
set search_path = ''
as $$
  select case when m < 60 then m || ' min'
              when m % 60 = 0 then (m / 60) || ' h'
              else (m / 60) || ' h ' || (m % 60) || ' min' end
    from (select greatest(floor(coalesce(p_minutos, 0)), 0)::bigint as m) x
$$;
revoke all on function app.espera_duracao(numeric) from public, anon, authenticated;

-- =====================================================================
-- 3. O aviso no celular: quem cruzou um degrau
-- =====================================================================
-- A rodada é a cada 10 segundos. A janela pega quem cruzou o degrau nos últimos
-- 15 minutos de expediente (uma rodada perdida não perde o aviso), e a chave
-- única impede o segundo aviso da mesma espera para a mesma pessoa. `p_agora` é
-- para o teste; a rodada usa a hora de agora.
create or replace function app.avisos_push_varrer_espera(p_agora timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cfg    jsonb := app.primeira_resposta_config();
  v_alvo   numeric := (v_cfg ->> 'alvo_min')::numeric;
  v_gestao numeric := (v_cfg ->> 'gestao_min')::numeric;
  v_janela constant numeric := 15;
  v_novos  integer;
begin
  -- Um comando só: as esperas são lidas uma vez e viram os avisos dos dois degraus.
  with cruzou as materialized (
    select e.conversation_id, e.assignee_id, e.desde, e.minutos
      from app.esperas_de_resposta(p_agora) e
     where (e.minutos >= v_alvo and e.minutos < v_alvo + v_janela)
        or (e.minutos >= v_gestao and e.minutos < v_gestao + v_janela)
  ),
  avisos as (
    -- Degrau 1: a regra do aviso de mensagem (antes da primeira resposta do time,
    -- todos que atendem; depois, numa conversa com ficha, o responsável que atende),
    -- sem quem silenciou a conversa.
    select d.pessoa, 'espera' as tipo, e.conversation_id, e.desde,
           app.nome_da_conversa(e.conversation_id) || ' espera resposta há '
             || app.espera_duracao(v_alvo) as texto
      from cruzou e
     cross join lateral app.avisos_destino_da_conversa(e.conversation_id, true) as d (pessoa)
     where e.minutos >= v_alvo and e.minutos < v_alvo + v_janela
    union all
    -- Degrau 2: admin e gestor ativos, sem quem silenciou a conversa, dizendo com quem está.
    select g.id, 'espera_gestao', e.conversation_id, e.desde,
           app.nome_da_conversa(e.conversation_id) || ' espera resposta há '
             || app.espera_duracao(v_gestao) || ' · '
             || case when e.assignee_id in (select q.id from app.avisos_quem_atende() as q (id))
                     then 'com ' || coalesce(app.primeiro_nome(e.assignee_id), 'alguém')
                     else 'sem responsável' end
      from cruzou e
     cross join public.team_directory g
     where e.minutos >= v_gestao and e.minutos < v_gestao + v_janela
       and g.is_active and g.role in ('admin', 'gestor')
       and not exists (select 1 from public.conversa_preferencias cp
                        where cp.profile_id = g.id and cp.conversation_id = e.conversation_id
                          and cp.silenciada_ate > now())
  )
  insert into app.push_fila (pessoa_id, tipo, chave, corpo, caminho, conversa_id)
  select a.pessoa, a.tipo,
         a.tipo || ':' || a.conversation_id || ':' || a.pessoa || ':' || extract(epoch from a.desde)::bigint,
         left(a.texto, 240), app.caminho_da_conversa(a.conversation_id), a.conversation_id
    from avisos a
  on conflict (chave) do nothing;
  get diagnostics v_novos = row_count;
  return v_novos;
end $$;
comment on function app.avisos_push_varrer_espera(timestamptz) is
  'Põe na fila os avisos da espera em degraus (11/11/2026): espera (alvo_min de expediente; antes da primeira resposta do time, para todos que atendem, depois, para o responsável: app.avisos_destino_da_conversa(c, true)) e espera_gestao (gestao_min, para admin e gestor, com quem está). Um por espera e por pessoa (a chave leva o começo da espera). Chamada por app.avisos_push_rodar, só na Imova.';
revoke all on function app.avisos_push_varrer_espera(timestamptz) from public, anon, authenticated;

-- =====================================================================
-- 4. O aviso no computador: o que vale para quem pergunta
-- =====================================================================
-- As esperas acima de cada degrau que a regra manda avisar a esta pessoa: as
-- mesmas pessoas do celular, sem as conversas que ela silenciou e sem o degrau
-- que ela desligou em "Avisos no celular". Sem janela: o site guarda o que já
-- anunciou, e quem abre o CRM depois do degrau ainda fica sabendo.
create or replace function app.esperas_da_pessoa(p_pessoa uuid, p_agora timestamptz default now())
returns table (conversa_id uuid, organizacao_id uuid, nome text, desde timestamptz,
               degrau text, minutos numeric, responsavel text)
language sql
stable
security definer
set search_path = ''
as $$
  with cfg as (
    select (x.c ->> 'alvo_min')::numeric as alvo, (x.c ->> 'gestao_min')::numeric as gestao
      from (select app.primeira_resposta_config() as c) x
  ),
  esperas as materialized (
    select e.* from app.esperas_de_resposta(p_agora) e cross join cfg
     where e.minutos >= least(cfg.alvo, cfg.gestao)
  )
  select e.conversation_id, e.organization_id, app.nome_da_conversa(e.conversation_id), e.desde,
         'espera', e.minutos, null::text
    from esperas e cross join cfg
   where e.minutos >= cfg.alvo
     and p_pessoa in (select d.pessoa
                        from app.avisos_destino_da_conversa(e.conversation_id, true) as d (pessoa))
     and not exists (select 1 from public.avisos_desligados x
                      where x.pessoa_id = p_pessoa and x.tipo = 'espera')
  union all
  select e.conversation_id, e.organization_id, app.nome_da_conversa(e.conversation_id), e.desde,
         'espera_gestao', e.minutos,
         case when e.assignee_id in (select q.id from app.avisos_quem_atende() as q (id))
              then coalesce(app.primeiro_nome(e.assignee_id), 'alguém') end
    from esperas e cross join cfg
   where e.minutos >= cfg.gestao
     and exists (select 1 from public.team_directory g
                  where g.id = p_pessoa and g.is_active and g.role in ('admin', 'gestor'))
     and not exists (select 1 from public.conversa_preferencias cp
                      where cp.profile_id = p_pessoa and cp.conversation_id = e.conversation_id
                        and cp.silenciada_ate > now())
     and not exists (select 1 from public.avisos_desligados x
                      where x.pessoa_id = p_pessoa and x.tipo = 'espera_gestao')
$$;
comment on function app.esperas_da_pessoa(uuid, timestamptz) is
  'As esperas acima de cada degrau que valem para uma pessoa (11/11/2026): espera (alvo_min, se a regra do aviso de mensagem a inclui: antes da primeira resposta do time, todos que atendem; depois, o responsável) e espera_gestao (gestao_min, se é admin ou gestor ativo), sem as conversas que ela silenciou e sem o degrau desligado. responsavel = o primeiro nome de quem atende, ou nulo (sem responsável). Só a Imova.';
revoke all on function app.esperas_da_pessoa(uuid, timestamptz) from public, anon, authenticated;

create or replace function public.esperas_para_avisar()
returns table (conversa_id uuid, organizacao_id uuid, nome text, desde timestamptz,
               degrau text, minutos numeric, responsavel text)
language sql
stable
security definer
set search_path = ''
as $$
  select * from app.esperas_da_pessoa(auth.uid(), now()) where auth.uid() is not null
$$;
comment on function public.esperas_para_avisar() is
  'O aviso de espera no computador (11/11/2026): as conversas acima de cada degrau que a regra manda avisar a quem está logado, a mesma regra do aviso no celular. Lida a cada 30 s por components/avisos/vigia-de-espera. Só a Imova.';
revoke all on function public.esperas_para_avisar() from public, anon;
grant execute on function public.esperas_para_avisar() to authenticated;

  $ddl$;
end $espera$;

-- =====================================================================
-- 5. O catálogo, a fila e a rodada (as duas empresas: os tipos novos só
--    aparecem no catálogo da Imova, e a rodada só chama a varredura lá)
-- =====================================================================
alter table app.push_fila drop constraint if exists push_fila_tipo_check;
alter table app.push_fila add constraint push_fila_tipo_check
  check (tipo in ('mensagem', 'transferencia', 'compromisso', 'lembrete', 'atrasada', 'resumo',
                  'lote', 'reuniao_robo', 'publicado', 'ligando', 'ligacao_perdida',
                  'lead_portal', 'espera', 'espera_gestao'));

create or replace function app.avisos_catalogo()
returns table (tipo text, nome text, descricao text, ordem integer)
language sql stable
set search_path = ''
as $$
  select v.tipo, v.nome, v.descricao, v.ordem
    from (values
      ('mensagem',        'Mensagem nova',              'Quando um cliente ou parceiro escreve no WhatsApp.',            1, null),
      ('transferencia',   'Conversa transferida',       'Quando alguém passa uma conversa para você.',                   2, null),
      ('compromisso',     'Compromisso marcado',        'Quando alguém marca uma reunião ou visita para você.',          3, null),
      ('lembrete',        'Lembrete de compromisso',    '30 minutos antes de cada reunião ou visita sua.',               4, null),
      ('atrasada',        'Resposta atrasada',          'Quando uma conversa espera a nossa resposta há 24 horas.',      5, null),
      ('resumo',          'Resumo das 8h',              'Um aviso por manhã com o que espera você no dia.',              6, null),
      ('lote',            'Lote para ligar',            'Quando a gestão monta ou passa um lote de ligações para você.', 7, 'komune'),
      ('reuniao_robo',    'Reunião marcada pelo robô',  'Quando o robô marca uma reunião com um parceiro seu.',          8, 'komune'),
      ('publicado',       'Parceiro publicado',         'Quando um parceiro seu é publicado na Komune.',                 9, 'komune'),
      ('ligando',         'Cliente ligando',            'Na hora em que um cliente liga pelo WhatsApp, enquanto toca.', 10, 'imova'),
      ('ligacao_perdida', 'Ligação perdida',            'Quando um cliente liga pelo WhatsApp e ninguém atende.',       11, 'imova'),
      ('lead_portal',     'Lead novo dos portais',      'Quando alguém escreve num anúncio do ZAP, do Viva Real ou da OLX.', 12, 'imova'),
      ('espera',          'Cliente esperando resposta', 'Quando um cliente espera a nossa resposta há 15 minutos de trabalho. Antes da primeira resposta, todos que atendem são avisados; depois, quem atende a conversa.', 13, 'imova'),
      ('espera_gestao',   'Cliente esperando há 1 hora', 'Para admin e gestor: quando um cliente espera a nossa resposta há 1 hora de trabalho, com o nome de quem atende.', 14, 'imova')
    ) as v (tipo, nome, descricao, ordem, empresa)
   where v.empresa is null or v.empresa = (select i.empresa from app.identidade i limit 1);
$$;
comment on function app.avisos_catalogo() is
  'Os avisos no celular desta empresa (entrevista de 06/11/2026; lead novo dos portais e a espera em degraus em 11/11/2026): os comuns e os só dela.';
revoke all on function app.avisos_catalogo() from public, anon, authenticated;

-- A rodada da 20261111120000, com a varredura da espera depois da dos leads. As
-- duas chamadas são dinâmicas: no banco da KOMUNE as funções não existem.
create or replace function app.avisos_push_rodar() returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_novos    integer := 0;
  v_enviados integer := 0;
  v_apagados integer := 0;
  v_leads    integer := 0;
  v_espera   integer := 0;
begin
  if not app.avisos_push_ligados() then
    return jsonb_build_object('ligado', false);
  end if;
  begin v_apagados := app.avisos_push_conferir();
  exception when others then raise warning 'avisos_push_conferir: %', sqlerrm; end;
  begin v_novos := app.avisos_push_varrer();
  exception when others then raise warning 'avisos_push_varrer: %', sqlerrm; end;
  if app.avisos_empresa() = 'imova'
     and to_regprocedure('app.avisos_push_varrer_leads()') is not null then
    begin
      execute 'select app.avisos_push_varrer_leads()' into v_leads;
      v_novos := v_novos + coalesce(v_leads, 0);
    exception when others then raise warning 'avisos_push_varrer_leads: %', sqlerrm; end;
  end if;
  -- 11/11/2026: a espera em degraus (15 min para quem atende, 1 h para a gestão).
  if app.avisos_empresa() = 'imova'
     and to_regprocedure('app.avisos_push_varrer_espera(timestamptz)') is not null then
    begin
      execute 'select app.avisos_push_varrer_espera(now())' into v_espera;
      v_novos := v_novos + coalesce(v_espera, 0);
    exception when others then raise warning 'avisos_push_varrer_espera: %', sqlerrm; end;
  end if;
  begin v_enviados := app.avisos_push_enviar();
  exception when others then raise warning 'avisos_push_enviar: %', sqlerrm; end;
  -- A fila e os envios guardam uma semana: é registro de aviso, não histórico.
  delete from app.push_fila where criado_em < now() - interval '7 days';
  delete from app.push_envios where enviado_em < now() - interval '7 days';
  return jsonb_build_object('ligado', true, 'novos', v_novos, 'enviados', v_enviados,
                            'aparelhos_esquecidos', v_apagados);
end $$;
comment on function app.avisos_push_rodar() is
  'A rodada dos avisos no celular, a cada 10 segundos pelo pg_cron: confere as respostas do Expo, varre o que aconteceu (e, na Imova, os leads novos dos portais e a espera em degraus) e manda o que estiver na fila.';
revoke all on function app.avisos_push_rodar() from public, anon, authenticated;

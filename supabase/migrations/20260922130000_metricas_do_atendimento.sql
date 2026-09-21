-- =====================================================================
-- Fase 4 — Métricas do atendimento
--
-- Plano aprovado pelo Rafael em 21/09/2026: "uma tela com 4 números — tempo de
-- 1ª resposta, conversas por atendente, conversão por etapa, motivos de perda".
-- Só leitura; nenhuma tabela nova.
--
-- TEMPO DE PRIMEIRA RESPOSTA, como é medido:
--   * uma "chegada" é a mensagem do parceiro que abre um bloco — a anterior da
--     conversa não era dele (ou não havia anterior);
--   * a resposta é a primeira mensagem NOSSA escrita por gente depois dela
--     (pessoa, ou rascunho da IA aprovado por pessoa). Menu automático, aviso de
--     fora do horário e confirmação de saída não contam: não são atendimento;
--   * só entram chegadas DENTRO do horário (seg–sex 8h–17h45): quem escreve às
--     23h e é respondido às 8h não mede a velocidade de ninguém.
-- A mediana, e não a média: uma conversa esquecida por três dias não pode
-- esconder que o resto foi respondido em minutos.
-- =====================================================================
create or replace function public.relatorio_atendimento(p_de date default null, p_ate date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_hoje date := (now() at time zone 'America/Fortaleza')::date;
  v_ate  date;
  v_dei  date;
  v_de   timestamptz;
  v_fim  timestamptz;
  v_res  jsonb;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  if not app.sees_all() then
    raise exception 'Papel % não tem acesso aos relatórios', app.role() using errcode = '42501';
  end if;
  v_ate := coalesce(p_ate, v_hoje);
  v_dei := coalesce(p_de, v_ate - 29);
  v_de  := (v_dei::timestamp) at time zone 'America/Fortaleza';
  v_fim := ((v_ate + 1)::timestamp) at time zone 'America/Fortaleza';

  with msgs as (
    select m.conversation_id, m.direction, m.author_kind, m.sent_by,
           coalesce(m.sent_at, m.created_at) as em
      from public.messages m
     where coalesce(m.sent_at, m.created_at) >= v_de - interval '3 days'
       and coalesce(m.sent_at, m.created_at) < v_fim + interval '3 days'
       and (m.direction = 'in'::app.msg_direction
            or (m.author_kind in ('human', 'bot_ai') and not m.optout_confirmation
                and m.status <> 'failed'::app.msg_status))
  ),
  marcadas as (
    select g.*, lag(g.direction) over (partition by g.conversation_id order by g.em) as anterior
      from msgs g
  ),
  chegadas as (
    select k.conversation_id, k.em
      from marcadas k
      join public.conversations c on c.id = k.conversation_id
     where k.direction = 'in'::app.msg_direction
       and (k.anterior is null or k.anterior <> 'in'::app.msg_direction)
       and k.em >= v_de and k.em < v_fim
       and coalesce((app.janela_do_canal(c.channel, k.em, true) ->> 'aberta')::boolean, false)
  ),
  respostas as (
    select ch.conversation_id, ch.em as chegou, r.em as respondeu, r.sent_by
      from chegadas ch
      left join lateral (
        select o.em, o.sent_by from msgs o
         where o.conversation_id = ch.conversation_id
           and o.direction = 'out'::app.msg_direction
           and o.em > ch.em
         order by o.em limit 1) r on true
  ),
  primeira as (
    select jsonb_build_object(
      'chegadas', count(*),
      'respondidas', count(respondeu),
      'sem_resposta', count(*) - count(respondeu),
      'mediana_min', round((percentile_cont(0.5) within group (
                        order by extract(epoch from (respondeu - chegou)) / 60.0)
                      filter (where respondeu is not null))::numeric, 0),
      'em_ate_1h', count(*) filter (where respondeu is not null and respondeu - chegou <= interval '1 hour')
    ) as j
      from respostas
  ),
  por_pessoa as (
    select coalesce(jsonb_agg(x order by x ->> 'nome'), '[]'::jsonb) as j
      from (
        select jsonb_build_object(
                 'pessoa_id', p.id,
                 'nome', p.full_name,
                 'conversas', (select count(distinct c.id) from public.conversations c
                                where c.assignee_id = p.id
                                  and c.last_message_at >= v_de and c.last_message_at < v_fim),
                 'mensagens', (select count(*) from public.messages m
                                where m.sent_by = p.id and m.direction = 'out'::app.msg_direction
                                  and coalesce(m.sent_at, m.created_at) >= v_de
                                  and coalesce(m.sent_at, m.created_at) < v_fim),
                 'respondidas', (select count(*) from respostas r where r.sent_by = p.id),
                 'mediana_min', (select round((percentile_cont(0.5) within group (
                                          order by extract(epoch from (r.respondeu - r.chegou)) / 60.0))::numeric, 0)
                                   from respostas r where r.sent_by = p.id)) as x
          from public.profiles p
         where p.is_active
           and p.role in ('admin', 'gestor', 'sdr', 'embaixador')
      ) t
     where (x ->> 'conversas')::int > 0 or (x ->> 'mensagens')::int > 0
  ),
  conversao as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'etapa', f.etapa_nome,
             'chegaram', f.chegaram_ate,
             'conversao', f.conversao_etapa) order by f.posicao), '[]'::jsonb) as j
      from public.relatorio_funil(v_dei, v_ate,
             (select pl.id from public.pipelines pl where pl.slug = 'fornecedor')) f
     where f.na_linha_do_funil
  ),
  perdas as (
    select coalesce(jsonb_agg(jsonb_build_object('motivo', t.motivo, 'total', t.total)
                              order by t.total desc, t.motivo), '[]'::jsonb) as j
      from (
        select coalesce(lr.name, 'Sem motivo informado') as motivo, count(*) as total
          from public.deals d
          left join public.lost_reasons lr on lr.id = d.lost_reason_id
         where d.lost_at >= v_de and d.lost_at < v_fim
         group by 1) t
  )
  select jsonb_build_object(
           'de', v_dei, 'ate', v_ate,
           'primeira_resposta', (select j from primeira),
           'por_atendente', (select j from por_pessoa),
           'conversao', (select j from conversao),
           'perdas', (select j from perdas))
    into v_res;

  return v_res;
end $$;

revoke all on function public.relatorio_atendimento(date, date) from public, anon;
grant execute on function public.relatorio_atendimento(date, date) to authenticated;

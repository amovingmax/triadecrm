-- =====================================================================
-- O dia de quem ligou
--
-- Pivô de 06/10/2026. A proposta do CRM ficou curta: a gestão enche a base de
-- fornecedores e produtores, gente contratada por diária liga, e a gestão
-- precisa de "um relatório exato e bem usual sobre tudo que ocorreu para cada
-- pessoa que ligou nesse dia". Quem liga também quer ver o próprio dia, "mais
-- clean e menos poluído".
--
-- ===========================================================================
-- UMA PERGUNTA SÓ, PARA OS DOIS LADOS
-- ===========================================================================
-- `public.ligacoes_do_dia(dia, pessoa)` responde às duas telas com a MESMA
-- conta, para o número que a pessoa vê no próprio dia ser o que a gestão vê no
-- relatório:
--
--   · a GESTÃO (admin e gestor) pergunta por qualquer pessoa, ou por ninguém —
--     e aí vem uma linha para cada pessoa que ligou naquele dia;
--   · quem LIGA pergunta só por si. Pedir o dia de outra pessoa é recusado.
--
-- A lista ligação a ligação só vem quando se pergunta por UMA pessoa: no
-- resumo de todos ela seria o dia inteiro do time numa resposta só.
--
-- ===========================================================================
-- DE ONDE SAI CADA NÚMERO
-- ===========================================================================
-- De `public.call_attempts`, que é uma linha por tentativa feita pela tela de
-- Ligar: quem, quando começou, se atendeu, quanto durou e como terminou. É a
-- mesma linha que a telefonia pelo navegador vai preencher (`provedor`), e por
-- isso o relatório não muda quando ela chegar — só a duração e o "atendeu"
-- deixam de ser o que a pessoa declarou.
--
--   ligacoes          toda tentativa iniciada no dia
--   atendidas         resultado = atendida_humano
--   nao_atendidas     qualquer outro resultado (não atendeu, caixa postal...)
--   sem_resultado     começou e não foi tabulada: é ligação que a pessoa
--                     abandonou, e num relatório exato ela aparece
--   tempo_falado_seg  soma da duração das atendidas
--   contatos          organizações diferentes
--
-- O dia é o de Natal (America/Fortaleza), como em todo o resto.
--
-- `outros_registros` conta o que a pessoa registrou no dia FORA da tela de
-- Ligar (visita, mensagem, ligação lançada à mão): não entra em nenhuma conta
-- acima, mas some do relatório seria esconder trabalho.
--
-- RF-MET-01, RF-REL-01
-- =====================================================================

create or replace function public.ligacoes_do_dia(p_dia date default null,
                                                  p_pessoa uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_eu    uuid := auth.uid();
  v_dia   date := coalesce(p_dia, (now() at time zone 'America/Fortaleza')::date);
  v_de    timestamptz;
  v_ate   timestamptz;
  v_alvo  uuid;
  v_ret   jsonb;
begin
  if v_eu is null
     or app.role() not in ('admin'::app.user_role, 'gestor'::app.user_role, 'sdr'::app.user_role) then
    raise exception 'Sem permissão para ver as ligações do dia' using errcode = '42501';
  end if;

  if app.is_manager() then
    v_alvo := p_pessoa;                       -- null = todo mundo que ligou
  elsif p_pessoa is not null and p_pessoa <> v_eu then
    raise exception 'Você só vê as suas próprias ligações' using errcode = '42501';
  else
    v_alvo := v_eu;
  end if;

  v_de  := v_dia::timestamp at time zone 'America/Fortaleza';
  v_ate := (v_dia + 1)::timestamp at time zone 'America/Fortaleza';

  with t as (
    select a.id, a.user_id, a.organization_id, a.iniciada_em, a.atendida_em, a.encerrada_em,
           a.duracao_seg, a.resultado, a.provedor,
           io.slug  as desfecho,
           io.name  as desfecho_nome,
           io.position as desfecho_ordem,
           o.name   as organizacao,
           nullif(btrim(act.body), '')              as observacao,
           nullif(act.metadata ->> 'com_quem', '')  as com_quem
      from public.call_attempts a
      left join public.interaction_outcomes io on io.id = a.outcome_id
      left join public.organizations o          on o.id = a.organization_id
      left join public.activities act           on act.id = a.activity_id
     where a.iniciada_em >= v_de and a.iniciada_em < v_ate
       and (v_alvo is null or a.user_id = v_alvo)
  ),
  -- Quem aparece: quem ligou. Perguntando por UMA pessoa, ela vem mesmo sem
  -- ligação nenhuma — "ainda não ligou hoje" é resposta, não é ausência.
  quem as (
    select distinct t.user_id from t
    union
    select v_alvo where v_alvo is not null
  ),
  totais as (
    select t.user_id,
           min(t.iniciada_em)                                              as primeira_em,
           max(coalesce(t.encerrada_em, t.iniciada_em))                    as ultima_em,
           count(*)::int                                                   as ligacoes,
           count(*) filter (where t.resultado = 'atendida_humano'::app.call_result)::int
                                                                           as atendidas,
           count(*) filter (where t.resultado is not null
                              and t.resultado <> 'atendida_humano'::app.call_result)::int
                                                                           as nao_atendidas,
           count(*) filter (where t.resultado is null)::int                as sem_resultado,
           coalesce(sum(t.duracao_seg)
                    filter (where t.resultado = 'atendida_humano'::app.call_result), 0)::int
                                                                           as tempo_falado_seg,
           count(distinct t.organization_id)::int                          as contatos,
           count(*) filter (where t.desfecho = 'lig_reuniao_marcada')::int as reunioes_marcadas
      from t
     group by t.user_id
  ),
  -- Como terminou cada ligação, numa lista só: o desfecho de quem atendeu, o
  -- resultado da linha de quem não atendeu, e as que ficaram sem tabular.
  como_foi as (
    select t.user_id,
           case when t.resultado is null then 'sem_resultado'
                when t.resultado = 'atendida_humano'::app.call_result
                  then coalesce(t.desfecho, 'atendida_sem_desfecho')
                else t.resultado::text end                                 as chave,
           case when t.resultado = 'atendida_humano'::app.call_result
                  then t.desfecho_nome end                                 as nome,
           t.resultado = 'atendida_humano'::app.call_result                as atendida,
           coalesce(case when t.resultado = 'atendida_humano'::app.call_result
                         then t.desfecho_ordem end, 0)                     as ordem
      from t
  ),
  resultados as (
    select c.user_id,
           jsonb_agg(jsonb_build_object('chave', c.chave, 'nome', c.nome,
                                        'atendida', c.atendida, 'quantas', c.quantas)
                     order by c.atendida desc nulls last, c.ordem, c.quantas desc, c.chave) as lista
      from (select user_id, chave, max(nome) as nome, bool_or(atendida) as atendida,
                   min(ordem) as ordem, count(*)::int as quantas
              from como_foi group by user_id, chave) c
     group by c.user_id
  ),
  optouts as (
    select ce.recorded_by as user_id, count(*)::int as quantos
      from public.consent_events ce
     where ce.kind = 'contact_optout'::app.consent_kind
       and ce.occurred_at >= v_de and ce.occurred_at < v_ate
       and ce.recorded_by in (select user_id from quem)
     group by ce.recorded_by
  ),
  outros as (
    select act.user_id, count(*)::int as quantos
      from public.activities act
     where act.type <> 'system'::app.activity_type
       and act.occurred_at >= v_de and act.occurred_at < v_ate
       and act.user_id in (select user_id from quem)
       and not exists (select 1 from public.call_attempts a where a.activity_id = act.id)
     group by act.user_id
  ),
  lista as (
    select t.user_id,
           jsonb_agg(jsonb_build_object(
             'id', t.id,
             'iniciada_em', t.iniciada_em,
             'duracao_seg', t.duracao_seg,
             'resultado', t.resultado,
             'desfecho', t.desfecho,
             'desfecho_nome', t.desfecho_nome,
             'organizacao_id', t.organization_id,
             'organizacao', t.organizacao,
             'com_quem', t.com_quem,
             'observacao', t.observacao,
             'provedor', t.provedor) order by t.iniciada_em, t.id) as ligacoes
      from t
     where v_alvo is not null
     group by t.user_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'pessoa_id',         q.user_id,
           'nome',              p.full_name,
           'papel',             p.role,
           'primeira_em',       tt.primeira_em,
           'ultima_em',         tt.ultima_em,
           'ligacoes',          coalesce(tt.ligacoes, 0),
           'atendidas',         coalesce(tt.atendidas, 0),
           'nao_atendidas',     coalesce(tt.nao_atendidas, 0),
           'sem_resultado',     coalesce(tt.sem_resultado, 0),
           'tempo_falado_seg',  coalesce(tt.tempo_falado_seg, 0),
           'contatos',          coalesce(tt.contatos, 0),
           'reunioes_marcadas', coalesce(tt.reunioes_marcadas, 0),
           'pediram_para_nao_ligar', coalesce(op.quantos, 0),
           'outros_registros',  coalesce(ou.quantos, 0),
           'resultados',        coalesce(r.lista, '[]'::jsonb),
           'lista',             case when v_alvo is null then null
                                     else coalesce(l.ligacoes, '[]'::jsonb) end)
           order by coalesce(tt.ligacoes, 0) desc, p.full_name), '[]'::jsonb)
    into v_ret
    from quem q
    join public.profiles p on p.id = q.user_id
    left join totais tt    on tt.user_id = q.user_id
    left join resultados r on r.user_id = q.user_id
    left join optouts op   on op.user_id = q.user_id
    left join outros ou    on ou.user_id = q.user_id
    left join lista l      on l.user_id = q.user_id;

  return jsonb_build_object('dia', v_dia, 'pessoas', v_ret);
end $$;
comment on function public.ligacoes_do_dia(date, uuid) is
  'O dia de quem ligou (pivô de 06/10/2026): por pessoa, quantas ligações fez, quantas atenderam, quanto tempo falou, como cada uma terminou e, pedindo uma pessoa só, a lista ligação a ligação. Admin e gestor perguntam por qualquer um (pessoa nula = todos que ligaram no dia); quem liga só vê o próprio dia. Lê public.call_attempts, a mesma linha que a telefonia pelo navegador preenche. O dia é o de America/Fortaleza.';
revoke all on function public.ligacoes_do_dia(date, uuid) from public, anon;
grant execute on function public.ligacoes_do_dia(date, uuid) to authenticated;

-- O relatório pergunta sempre "as ligações de um intervalo", com ou sem pessoa.
create index if not exists call_attempts_do_dia
  on public.call_attempts (iniciada_em, user_id);

notify pgrst, 'reload schema';

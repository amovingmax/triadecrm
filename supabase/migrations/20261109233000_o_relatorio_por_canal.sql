-- =====================================================================
-- O relatório por canal de chegada, só na Imova (06/11/2026)
--
-- Terceira parte do canal de chegada (20261109220000, 20261109230000). O
-- Rafael quer "controle e conhecimento" de por onde os leads chegam, e que a
-- foto da placa ou do banner da Imova fique registrada no relatório.
--
-- Por que não o painel "Fontes" (`public.relatorio_por_fonte`): ele conta
-- FICHAS por `source_id` com os degraus da KOMUNE (alvos, contatados,
-- autorizaram, publicaram). Aqui a unidade é a CHEGADA — cada vez que alguém
-- procurou a Imova —, por canal e subcanal, com os degraus de imobiliária:
-- atendido, visita marcada, visita realizada, negócio ganho.
--
-- Mesmo acesso dos outros relatórios (`app.sees_all`: admin, gestor, SDR) e
-- datas em America/Fortaleza. SÓ DA IMOVA: no banco da KOMUNE nada é criado.
-- =====================================================================

do $relatorio_canal$
begin
  if (select i.empresa from app.identidade i) = 'komune' then
    raise notice 'O relatório por canal de chegada é só da Imova: no banco da KOMUNE nada foi criado.';
    return;
  end if;
  execute $ddl$

create or replace function public.relatorio_por_canal(p_de date default null, p_ate date default null)
returns table (
  canal               text,
  subcanal            text,
  chegadas            int,
  leads_novos         int,
  ja_na_base          int,
  sem_ficha           int,
  atendidos           int,
  visitas_marcadas    int,
  visitas_realizadas  int,
  ganhos              int,
  por_regra           int,
  por_ia              int,
  por_gente           int,
  corrigidos          int,
  com_foto_da_placa   int,
  com_foto_do_banner  int
)
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
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  if not app.sees_all() then
    raise exception 'Papel % não tem acesso aos relatórios', app.role() using errcode = '42501';
  end if;
  if not coalesce((app.canal_de_chegada_config() ->> 'ligada')::boolean, false) then
    return;
  end if;
  v_ate := coalesce(p_ate, v_hoje);
  v_dei := coalesce(p_de, v_ate - 29);
  v_de  := (v_dei::timestamp) at time zone 'America/Fortaleza';
  v_fim := ((v_ate + 1)::timestamp) at time zone 'America/Fortaleza';

  return query
  with ch as (
    select c.id, c.conversation_id, c.inicio_em, c.canal_marcado, c.canal_automatico, c.decidido_por, c.foto,
           cv.organization_id as org_id,
           coalesce(c.canal, 'nao_identificado') as canal_ef,
           coalesce(case when c.canal_marcado is not null then c.subcanal_marcado else c.subcanal_automatico end,
                    'desconhecido') as sub_ef,
           exists (select 1 from public.chegadas a
                    where a.conversation_id = c.conversation_id and a.inicio_em < c.inicio_em) as voltou,
           o.created_at as org_criada_em
      from public.chegadas c
      join public.conversations cv on cv.id = c.conversation_id
      left join public.organizations o on o.id = cv.organization_id
     where c.inicio_em >= v_de and c.inicio_em < v_fim
  ), conta as (
    select ch.*,
           -- Já estava na base: voltou depois de 30 dias, ou a ficha é de antes
           -- da chegada (a ficha automática nasce no minuto seguinte).
           (ch.voltou or ch.org_criada_em < ch.inicio_em - interval '10 minutes') as ja_estava,
           exists (select 1 from public.messages m
                    where m.conversation_id = ch.conversation_id
                      and m.direction = 'out'::app.msg_direction
                      and m.author_kind = 'human'
                      and m.created_at >= ch.inicio_em) as atendido,
           exists (select 1 from public.reunioes r
                    where ch.org_id is not null and r.organization_id = ch.org_id
                      and r.criada_em >= ch.inicio_em and r.estado <> 'cancelada') as visita_marcada,
           exists (select 1 from public.reunioes r
                    where ch.org_id is not null and r.organization_id = ch.org_id
                      and r.criada_em >= ch.inicio_em and r.estado = 'realizada') as visita_realizada,
           exists (select 1 from public.deals d
                    where ch.org_id is not null and d.organization_id = ch.org_id
                      and d.status = 'won'::app.deal_status
                      and coalesce(d.won_at, d.updated_at) >= ch.inicio_em) as ganho
      from ch
  )
  select k.canal_ef,
         k.sub_ef,
         count(*)::int,
         count(*) filter (where not k.ja_estava)::int,
         count(*) filter (where k.ja_estava)::int,
         count(*) filter (where k.org_id is null)::int,
         count(*) filter (where k.atendido)::int,
         count(*) filter (where k.visita_marcada)::int,
         count(*) filter (where k.visita_realizada)::int,
         count(*) filter (where k.ganho)::int,
         count(*) filter (where k.canal_marcado is null and k.decidido_por = 'regra')::int,
         count(*) filter (where k.canal_marcado is null and k.decidido_por = 'ia')::int,
         count(*) filter (where k.canal_marcado is not null)::int,
         count(*) filter (where k.canal_marcado is not null and k.canal_automatico is not null
                            and k.canal_marcado <> k.canal_automatico)::int,
         count(*) filter (where k.sub_ef = 'foto_da_placa'
                            or (k.foto ->> 'peca' = 'placa' and k.foto ->> 'marca' = 'imova'))::int,
         count(*) filter (where k.sub_ef = 'foto_do_banner'
                            or (k.foto ->> 'peca' = 'banner' and k.foto ->> 'marca' = 'imova'))::int
    from conta k
   group by k.canal_ef, k.sub_ef
   order by array_position(array['placa', 'anuncios', 'redes_sociais', 'outros', 'nao_identificado'], k.canal_ef),
            count(*) desc, k.sub_ef;
end $$;
comment on function public.relatorio_por_canal(date, date) is
  'As chegadas do período (America/Fortaleza; padrão: os últimos 30 dias) por canal e subcanal, com os degraus de imobiliária (atendido, visita marcada e realizada, ganho), quem decidiu (regra, IA, gente), as correções e quantas trouxeram foto da placa ou do banner da Imova. Admin, gestor e SDR (app.sees_all).';
revoke all on function public.relatorio_por_canal(date, date) from public, anon;
grant execute on function public.relatorio_por_canal(date, date) to authenticated;

  $ddl$;
end $relatorio_canal$;

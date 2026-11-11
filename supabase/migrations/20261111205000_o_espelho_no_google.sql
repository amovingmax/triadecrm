-- =====================================================================
-- O espelho no Google sai do silêncio e passa a levar os feriados — só na
-- Imova (11/11/2026)
--
-- O gargalo: o que a equipe marca no CRM continua livre no Calendly. O
-- cliente escolhe o horário, recebe "confirmado" e, segundos depois,
-- "cancelado" (a rede de segurança do `calendly_receber`). O código do
-- espelho existe desde 10/11 (migração 20261110180000, B10), mas ficou
-- desligado e em silêncio: sem `app_settings['calendly'].google_agenda_id`
-- o worker não fazia nada e não dizia nada, e ninguém via na tela se o
-- Google estava gravando ou recusando. E o Calendly oferece os feriados da
-- Imova (20/11 e 21/11), porque só sabe "seg. a sex.".
--
-- O que muda:
--
--   1. OS FERIADOS VÃO AO GOOGLE. Cada feriado de `public.holidays` dos
--      próximos 12 meses vira um bloco "Ocupado — feriado" de dia inteiro na
--      agenda que o Calendly confere, e o Calendly deixa de oferecer o dia. O
--      id do bloco sai da data (`app.agenda_espelho_id_do_feriado`): gravar de
--      novo não duplica, e dois feriados na mesma data (o nacional e o
--      municipal) são um bloco só. Feriado apagado, ou trocado de data, tira
--      o bloco pelo caminho de sempre (`apagar`).
--   2. O QUE O ESPELHO QUER NO GOOGLE TEM UMA DEFINIÇÃO SÓ
--      (`app.agenda_espelho_desejado`): os compromissos da agenda do Calendly
--      que não vieram dele (a régua `app.agenda_ocupada`, 120 dias) e os
--      feriados. A lista do worker e o estado da tela contam pela mesma.
--   3. O ESTADO DO ESPELHO, PARA A TELA (`public.agenda_espelho_estado`, só
--      admin e gestor): se o id da agenda está preenchido, se o worker está
--      passando, de quem é a agenda espelhada, quantos itens estão
--      pendentes, gravados e com erro, o último gravado e o último erro, com
--      a data e desde quando. Para isso:
--        · `app.agenda_espelho` ganha `tipo` (compromisso ou feriado),
--          `erro_em` e `erro_desde` (a primeira falha desde o último acerto);
--        · `app.agenda_espelho_situacao` (uma linha) guarda quando o worker
--          passou pela última vez (no máximo uma escrita por minuto), o
--          último gravado e o último erro, que não somem quando a linha do
--          item sai da tabela.
--
-- O worker e a tela acompanham (mesma entrega): `apps/workers/src/agenda`
-- grava o feriado como evento de dia inteiro e loga uma vez "espelho
-- desligado: falta google_agenda_id em app_settings[calendly]"; a Agenda
-- mostra ao admin o cartão "Espelho no Google". O worker antigo lê a lista
-- nova sem quebrar: ignora `tipo` e grava o feriado como um bloco das 0h às
-- 24h, que também tira o dia do Calendly.
--
-- O QUE NÃO MUDA: `calendly_receber`, `calendly_dono`,
-- `calendly_pessoa_da_agenda` e `calendly_config` (são de outra entrega, e
-- aqui só são lidos). As assinaturas de `agenda_espelho_gravado`, `_apagado`
-- e `_falhou` são as mesmas: o worker publicado continua chamando igual.
-- Nada vai ao WhatsApp. Ao Google continua indo só início, fim e o título
-- fixo, agora também "Ocupado — feriado".
--
-- NA KOMUNE NADA ENTRA: o bloco inteiro é da Imova, como o B10 de
-- 20261110180000.
--
-- COMO DESFAZER (no banco da Imova): reaplicar as quatro funções
-- agenda_espelho_* do B10 de 20261110180000; drop function
-- public.agenda_espelho_estado(), app.agenda_espelho_desejado(uuid),
-- app.agenda_espelho_id_do_feriado(date), app.agenda_espelho_situacao_marcar(text, text);
-- drop table app.agenda_espelho_situacao; alter table app.agenda_espelho drop
-- column tipo, drop column erro_em, drop column erro_desde. Os blocos
-- "Ocupado — feriado" que já estão no Google Agenda ficam lá: apague-os pelo
-- próprio Google Agenda.
-- =====================================================================

do $espelho$
begin
  if (select i.empresa from app.identidade i) = 'komune' then
    raise notice 'O espelho no Google é só da Imova: no banco da KOMUNE nada foi criado.';
    return;
  end if;
  if to_regclass('app.agenda_espelho') is null then
    raise notice 'Este banco não tem o espelho no Google (20261110180000): nada a fazer.';
    return;
  end if;
  execute $ddl$

-- =====================================================================
-- 1. O que o espelho guarda
-- =====================================================================
alter table app.agenda_espelho add column if not exists tipo text not null default 'compromisso';
alter table app.agenda_espelho drop constraint if exists agenda_espelho_tipo_chk;
alter table app.agenda_espelho add constraint agenda_espelho_tipo_chk
  check (tipo in ('compromisso', 'feriado'));
alter table app.agenda_espelho add column if not exists erro_em timestamptz;
alter table app.agenda_espelho add column if not exists erro_desde timestamptz;
comment on column app.agenda_espelho.tipo is
  'compromisso (reunião ou visita da agenda do Calendly, com hora) ou feriado (bloco de dia inteiro, id tirado da data).';
comment on column app.agenda_espelho.erro_em is
  'A última vez que o Google recusou este item. Some quando ele grava ou apaga.';
comment on column app.agenda_espelho.erro_desde is
  'A primeira recusa desde o último acerto deste item: é o "com erro desde" da tela. Some quando ele grava ou apaga.';

create table if not exists app.agenda_espelho_situacao (
  unica       boolean primary key default true check (unica),
  -- A última vez que o worker pediu a lista (no máximo uma escrita por minuto).
  -- Só o worker com a chave do Google pede: sem ela, isto não anda.
  passou_em   timestamptz,
  gravou_em   timestamptz,
  errou_em    timestamptz,
  erro        text check (char_length(erro) <= 500)
);
alter table app.agenda_espelho_situacao enable row level security;
revoke all on app.agenda_espelho_situacao from anon, authenticated;
comment on table app.agenda_espelho_situacao is
  'Uma linha: quando o worker passou pelo espelho, o último bloco gravado e o último erro do Google. Escrita só pelas funções agenda_espelho_*; lida por agenda_espelho_estado.';

create or replace function app.agenda_espelho_situacao_marcar(p_campo text, p_erro text default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_campo = 'passou' then
    -- O worker passa a cada 15 s; gravar uma vez por minuto basta para dizer
    -- "está passando" sem encher o WAL.
    insert into app.agenda_espelho_situacao as s (unica, passou_em) values (true, now())
    on conflict (unica) do update set passou_em = excluded.passou_em
     where s.passou_em is null or s.passou_em < now() - interval '1 minute';
  elsif p_campo = 'gravou' then
    insert into app.agenda_espelho_situacao as s (unica, gravou_em) values (true, now())
    on conflict (unica) do update set gravou_em = excluded.gravou_em;
  elsif p_campo = 'errou' then
    insert into app.agenda_espelho_situacao as s (unica, errou_em, erro)
    values (true, now(), left(coalesce(nullif(btrim(p_erro), ''), 'erro sem descrição'), 500))
    on conflict (unica) do update set errou_em = excluded.errou_em, erro = excluded.erro;
  end if;
end $$;

-- =====================================================================
-- 2. O id do feriado e o que o espelho quer no Google
-- =====================================================================
-- Um uuid tirado da data: o mesmo a cada passada, e o evento no Google é ele
-- sem hífens (hexadecimal, base32hex válido), como o dos compromissos.
create or replace function app.agenda_espelho_id_do_feriado(p_dia date)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select md5('triade-crm:agenda-espelho:feriado:' || to_char(p_dia, 'YYYYMMDD'))::uuid
$$;
comment on function app.agenda_espelho_id_do_feriado(date) is
  'O id estável do bloco "Ocupado — feriado" de um dia no Google Agenda (sem hífens, é o id do evento).';

create or replace function app.agenda_espelho_desejado(p_pessoa uuid)
returns table (item_id uuid, tipo text, inicio timestamptz, fim timestamptz, dia date)
language sql
stable
security definer
set search_path = ''
as $$
  -- Os compromissos da agenda do Calendly que não vieram dele (o Calendly já
  -- bloqueia o que é dele), pela régua de "ocupado".
  select o.item_id, 'compromisso'::text, o.inicio, o.fim, null::date
    from app.agenda_ocupada(p_pessoa, now(), now() + interval '120 days') o
   where p_pessoa is not null and o.origem <> 'calendly'
  union all
  -- Os feriados dos próximos 12 meses, um bloco por data, de meia-noite a
  -- meia-noite em Natal.
  select app.agenda_espelho_id_do_feriado(f.dia), 'feriado'::text,
         f.dia::timestamp at time zone 'America/Fortaleza',
         (f.dia + 1)::timestamp at time zone 'America/Fortaleza',
         f.dia
    from (select distinct h.date as dia
            from public.holidays h
           where h.date >= (now() at time zone 'America/Fortaleza')::date
             and h.date < ((now() at time zone 'America/Fortaleza')::date + interval '12 months')::date) f
$$;
comment on function app.agenda_espelho_desejado(uuid) is
  'O que deve estar no Google Agenda que o Calendly confere: os compromissos da agenda do Calendly que não vieram dele (120 dias) e um bloco de dia inteiro por feriado dos próximos 12 meses.';

-- =====================================================================
-- 3. A lista do worker
-- =====================================================================
create or replace function public.agenda_espelho_pendencias(p_limite int default 20)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_cal    text := nullif(btrim(coalesce(app.calendly_config() ->> 'google_agenda_id', '')), '');
  v_pessoa uuid := app.calendly_pessoa_da_agenda();
  v_lim    int  := greatest(1, least(coalesce(p_limite, 20), 100));
  v_gravar jsonb;
  v_apagar jsonb;
begin
  -- Quem pede é o worker com a chave do Google: é por aqui que a tela sabe
  -- que ele está passando, ligado ou não.
  perform app.agenda_espelho_situacao_marcar('passou');
  if v_cal is null then
    return jsonb_build_object('ligado', false, 'motivo', 'sem_google_agenda_id');
  end if;
  -- O que já passou sai da conta sem ir ao Google: o bloco antigo fica lá como
  -- história e não ocupa nada que alguém ainda possa marcar.
  delete from app.agenda_espelho where fim < now() - interval '1 day';

  with gravar as (
    select d.item_id, d.tipo, d.inicio, d.fim, d.dia
      from app.agenda_espelho_desejado(v_pessoa) d
      left join app.agenda_espelho e on e.item_id = d.item_id
     where (e.item_id is null or e.gravado_em is null or e.inicio <> d.inicio or e.fim <> d.fim)
       and (e.depois_de is null or e.depois_de <= now())
     order by d.inicio
     limit v_lim
  )
  select coalesce(jsonb_agg(
           jsonb_build_object('item_id', g.item_id,
                              'evento_id', replace(g.item_id::text, '-', ''),
                              'tipo', g.tipo,
                              'inicio', g.inicio, 'fim', g.fim)
           -- O feriado vai ao Google como dia inteiro: o dia e o seguinte (o
           -- fim do Google é exclusivo).
           || case when g.tipo = 'feriado'
                   then jsonb_build_object('dia', to_char(g.dia, 'YYYY-MM-DD'),
                                           'ate', to_char(g.dia + 1, 'YYYY-MM-DD'))
                   else '{}'::jsonb end
           order by g.inicio), '[]'::jsonb)
    into v_gravar from gravar g;

  select coalesce(jsonb_agg(jsonb_build_object('item_id', e.item_id,
                                               'evento_id', replace(e.item_id::text, '-', ''))), '[]'::jsonb)
    into v_apagar
    from (select e2.item_id from app.agenda_espelho e2
           where not exists (select 1 from app.agenda_espelho_desejado(v_pessoa) d where d.item_id = e2.item_id)
             and (e2.depois_de is null or e2.depois_de <= now())
           limit v_lim) e;

  return jsonb_build_object('ligado', true, 'calendario', v_cal, 'gravar', v_gravar, 'apagar', v_apagar);
end $$;
comment on function public.agenda_espelho_pendencias(int) is
  'O que falta no Google Agenda que o Calendly confere (app.agenda_espelho_desejado): compromissos para gravar ou mudar, feriados de dia inteiro (tipo, dia, ate), e o que saiu, para apagar. Desligado sem app_settings[calendly].google_agenda_id. Cada chamada marca que o worker passou.';

-- =====================================================================
-- 4. As respostas do worker (mesmas assinaturas do B10)
-- =====================================================================
create or replace function public.agenda_espelho_gravado(p_item uuid, p_inicio timestamptz, p_fim timestamptz)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  insert into app.agenda_espelho (item_id, inicio, fim, gravado_em, tentativas, depois_de, erro,
                                  tipo, erro_em, erro_desde)
  values (p_item, p_inicio, p_fim, now(), 0, null, null,
          -- O feriado se reconhece pelo id, que sai da data em que ele começa.
          case when p_item = app.agenda_espelho_id_do_feriado((p_inicio at time zone 'America/Fortaleza')::date)
               then 'feriado' else 'compromisso' end,
          null, null)
  on conflict (item_id) do update
     set inicio = excluded.inicio, fim = excluded.fim, gravado_em = now(),
         tentativas = 0, depois_de = null, erro = null, erro_em = null, erro_desde = null;
  perform app.agenda_espelho_situacao_marcar('gravou');
end $$;

create or replace function public.agenda_espelho_apagado(p_item uuid)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  delete from app.agenda_espelho where item_id = p_item
$$;

create or replace function public.agenda_espelho_falhou(p_item uuid, p_inicio timestamptz, p_fim timestamptz, p_erro text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_erro text := left(coalesce(nullif(btrim(p_erro), ''), 'erro sem descrição'), 500);
begin
  insert into app.agenda_espelho (item_id, inicio, fim, gravado_em, tentativas, depois_de, erro,
                                  tipo, erro_em, erro_desde)
  values (p_item, coalesce(p_inicio, now()), coalesce(p_fim, now()), null, 1,
          now() + interval '1 minute', v_erro,
          case when p_inicio is not null
                and p_item = app.agenda_espelho_id_do_feriado((p_inicio at time zone 'America/Fortaleza')::date)
               then 'feriado' else 'compromisso' end,
          now(), now())
  on conflict (item_id) do update
     set tentativas = app.agenda_espelho.tentativas + 1,
         depois_de = now() + make_interval(mins => least(60, (2 ^ least(app.agenda_espelho.tentativas, 6))::int)),
         erro = excluded.erro,
         erro_em = now(),
         erro_desde = coalesce(app.agenda_espelho.erro_desde, now());
  perform app.agenda_espelho_situacao_marcar('errou', v_erro);
end $$;

-- =====================================================================
-- 5. O estado do espelho, para a tela (admin e gestor)
-- =====================================================================
create or replace function public.agenda_espelho_estado()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cal       text := nullif(btrim(coalesce(app.calendly_config() ->> 'google_agenda_id', '')), '');
  v_pessoa    uuid := app.calendly_pessoa_da_agenda();
  v_sit       app.agenda_espelho_situacao%rowtype;
  v_pendentes int;
  v_gravados  int;
  v_feriados  int;
  v_com_erro  int;
  v_ultimo    timestamptz;
  v_erro      jsonb;
  v_passando  boolean;
begin
  if not coalesce(app.admin_ou_gestor(), false) then
    raise exception 'Só admin e gestor veem o estado do espelho no Google.' using errcode = '42501';
  end if;

  select * into v_sit from app.agenda_espelho_situacao where unica;
  v_passando := v_sit.passou_em is not null and v_sit.passou_em > now() - interval '5 minutes';

  -- Pendente: o que o Google ainda não tem como deve (inclusive o que espera
  -- depois de uma recusa) e o que ainda está lá e deveria sair.
  select count(*) into v_pendentes
    from app.agenda_espelho_desejado(v_pessoa) d
    left join app.agenda_espelho e on e.item_id = d.item_id
   where e.item_id is null or e.gravado_em is null or e.inicio <> d.inicio or e.fim <> d.fim;
  select v_pendentes + count(*) into v_pendentes
    from app.agenda_espelho e
   where not exists (select 1 from app.agenda_espelho_desejado(v_pessoa) d where d.item_id = e.item_id);

  select count(*) filter (where e.tipo = 'compromisso'),
         count(*) filter (where e.tipo = 'feriado')
    into v_gravados, v_feriados
    from app.agenda_espelho e
   where e.gravado_em is not null and e.fim >= now();
  select count(*) into v_com_erro from app.agenda_espelho e where e.erro is not null;

  v_ultimo := greatest(v_sit.gravou_em, (select max(e.gravado_em) from app.agenda_espelho e));

  if v_com_erro > 0 then
    select jsonb_build_object('erro', e.erro, 'em', e.erro_em,
                              'desde', (select min(e2.erro_desde) from app.agenda_espelho e2
                                         where e2.erro is not null),
                              'ativo', true)
      into v_erro
      from app.agenda_espelho e
     where e.erro is not null
     order by e.erro_em desc nulls last
     limit 1;
  elsif v_sit.erro is not null then
    v_erro := jsonb_build_object('erro', v_sit.erro, 'em', v_sit.errou_em, 'desde', null, 'ativo', false);
  end if;

  return jsonb_build_object(
    'ligado', v_cal is not null and v_passando,
    'google_agenda_id_preenchido', v_cal is not null,
    'google_agenda_id', v_cal,
    'worker_passando', v_passando,
    'worker_passou_em', v_sit.passou_em,
    'pessoa', case when v_pessoa is null then null
                   else jsonb_build_object('id', v_pessoa,
                                           'nome', (select p.full_name from public.profiles p where p.id = v_pessoa))
              end,
    'pendentes', v_pendentes,
    'gravados', v_gravados,
    'feriados', v_feriados,
    'com_erro', v_com_erro,
    'ultimo_gravado_em', v_ultimo,
    'ultimo_erro', v_erro,
    'agora', now());
end $$;
comment on function public.agenda_espelho_estado() is
  'O espelho no Google em linguagem de tela (só admin e gestor): se o id da agenda está preenchido, se o worker está passando, de quem é a agenda espelhada, quantos itens estão pendentes, gravados (e feriados) e com erro, o último gravado e o último erro, com a data e desde quando.';

-- =====================================================================
-- 6. Quem chama
-- =====================================================================
revoke all on function app.agenda_espelho_situacao_marcar(text, text) from public, anon, authenticated;
revoke all on function app.agenda_espelho_id_do_feriado(date) from public, anon, authenticated;
revoke all on function app.agenda_espelho_desejado(uuid) from public, anon, authenticated;
revoke all on function public.agenda_espelho_pendencias(int) from public, anon, authenticated;
revoke all on function public.agenda_espelho_gravado(uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.agenda_espelho_apagado(uuid) from public, anon, authenticated;
revoke all on function public.agenda_espelho_falhou(uuid, timestamptz, timestamptz, text) from public, anon, authenticated;
revoke all on function public.agenda_espelho_estado() from public, anon;
grant execute on function public.agenda_espelho_pendencias(int) to service_role;
grant execute on function public.agenda_espelho_gravado(uuid, timestamptz, timestamptz) to service_role;
grant execute on function public.agenda_espelho_apagado(uuid) to service_role;
grant execute on function public.agenda_espelho_falhou(uuid, timestamptz, timestamptz, text) to service_role;
grant execute on function public.agenda_espelho_estado() to authenticated, service_role;

  $ddl$;
end $espelho$;

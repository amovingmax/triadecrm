-- =====================================================================
-- Quem recebe os avisos: cada navegador conta que está avisando, e a
-- gestão vê quem fica sem aviso nenhum — só na Imova (11/11/2026)
--
-- Gargalo da revisão de 11/11/2026: o app de celular só está no iPhone do
-- dono (TestFlight), o e-mail de aviso está desligado e cada computador da
-- equipe só avisa se alguém ligou a notificação do navegador. Ninguém sabia
-- quem estava recebendo. Pedido: "Instalar o app em toda a equipe ou, no
-- mínimo, ligar a notificação do navegador em cada computador."
--
-- O que entra aqui:
--
--   1. OS NAVEGADORES. `app.avisos_navegadores` guarda, por pessoa, cada
--      navegador em que ela abriu o CRM: um id sorteado pelo próprio navegador
--      (fica no localStorage dele), a permissão de notificação, se o som está
--      ligado, se ela silenciou os avisos no menu, um rótulo legível ("Chrome
--      no Mac") e quando foi o último sinal. Nada além disso: nem endereço de
--      IP, nem a identificação inteira do navegador.
--   2. QUEM GRAVA. Só `public.avisos_registrar_navegador`, e só para a própria
--      pessoa (`auth.uid()`). O site chama ao abrir e quando a permissão, o som
--      ou o silêncio mudam, no máximo uma vez por hora para o mesmo estado; o
--      banco também segura: o mesmo estado dentro da hora não regrava nada.
--      Navegador sem sinal há 30 dias deixa de contar (e é apagado na próxima
--      vez em que a pessoa registra qualquer navegador); cada pessoa guarda no
--      máximo 20.
--   3. A VISÃO DA GESTÃO. `public.avisos_quem_recebe()`, só para admin e
--      gestor (Ajustes → Avisos): uma linha por pessoa ativa que atende
--      (admin, gestor e SDR), com o celular (o app registrado em
--      `public.aparelhos_push`, o aviso de mensagem nova ligado e a chave geral
--      `avisos.push`), o computador (navegadores com aviso ligado nos últimos
--      30 dias) e a situação: recebe nos dois, só no computador, só no celular,
--      ou não recebe aviso nenhum.
--
-- O celular conta todo aparelho registrado, e não só os dos últimos 30 dias:
-- o aviso continua chegando a ele, e o próprio envio esquece o aparelho de
-- onde o app saiu (`app.avisos_push_conferir`). O último sinal é a última vez
-- que o app abriu.
--
-- NA KOMUNE NADA MUDA. O bloco abaixo não roda lá. E as duas funções também
-- travam pela identidade: no banco em que a migração roda antes de a
-- identidade existir (o do CI), a KOMUNE fica com elas e elas não gravam nem
-- mostram ninguém.
--
-- NADA DE AVISO SAI DAQUI. Nenhuma linha em `app.push_fila`, nenhuma mudança
-- no catálogo nem na rodada dos avisos, nenhum gatilho em mensagem ou
-- conversa. O teste de aviso do computador é local, no próprio navegador.
--
-- COMO DESFAZER (no banco da Imova): drop function
-- public.avisos_quem_recebe(); drop function
-- public.avisos_registrar_navegador(uuid, text, boolean, boolean, text);
-- drop table app.avisos_navegadores.
-- =====================================================================

do $quem$
begin
  if (select i.empresa from app.identidade i) = 'komune' then
    raise notice 'Quem recebe os avisos é só da Imova: no banco da KOMUNE nada foi criado.';
    return;
  end if;
  execute $ddl$

-- =====================================================================
-- 1. Os navegadores
-- =====================================================================
create table if not exists app.avisos_navegadores (
  pessoa_id   uuid not null references public.profiles (id) on delete cascade,
  -- Sorteado pelo navegador e guardado no localStorage dele. Dois colegas no
  -- mesmo computador são duas linhas: o aviso é de quem está logado.
  aparelho_id uuid not null,
  -- A permissão de notificação, nos nomes do site (`aviso-do-navegador.ts`):
  -- liberada (granted), a_pedir (default), bloqueada (denied) ou sem_suporte
  -- (o Safari do iPhone, fora de um app instalado).
  permissao   text not null
                check (permissao in ('liberada', 'a_pedir', 'bloqueada', 'sem_suporte')),
  som_ligado  boolean not null default true,
  -- "Silenciar avisos de resposta", no menu com o nome da pessoa.
  silenciado  boolean not null default false,
  rotulo      text not null
                check (char_length(rotulo) between 1 and 60 and rotulo !~ '[[:cntrl:]]'),
  criado_em   timestamptz not null default now(),
  visto_em    timestamptz not null default now(),
  primary key (pessoa_id, aparelho_id)
);
create index if not exists avisos_navegadores_visto on app.avisos_navegadores (pessoa_id, visto_em desc);
alter table app.avisos_navegadores enable row level security;
-- Sem política: ninguém lê nem grava direto. Só as duas funções abaixo.
revoke all on app.avisos_navegadores from public, anon, authenticated;
comment on table app.avisos_navegadores is
  'Cada navegador em que alguém que atende abriu o CRM, e se ele avisa (11/11/2026, só na Imova): permissão de notificação, som, silêncio, um rótulo como "Chrome no Mac" e o último sinal. Gravado só por public.avisos_registrar_navegador; lido só por public.avisos_quem_recebe.';

-- =====================================================================
-- 2. Quem grava: a própria pessoa, sobre o navegador dela
-- =====================================================================
create or replace function public.avisos_registrar_navegador(
  p_aparelho   uuid,
  p_permissao  text,
  p_som        boolean,
  p_silenciado boolean,
  p_rotulo     text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_eu     uuid := auth.uid();
  -- Só o que a tela vai mostrar: uma linha curta, sem caractere de controle.
  v_rotulo text := btrim(left(btrim(regexp_replace(coalesce(p_rotulo, ''), '[[:cntrl:][:space:]]+', ' ', 'g')), 60));
begin
  -- O banco também trava: onde a migração rodou antes de a identidade existir
  -- (o banco do CI), a KOMUNE tem a função e não grava nada.
  if app.avisos_empresa() = 'komune' then
    return;
  end if;
  if v_eu is null then
    raise exception 'sem sessão' using errcode = '42501';
  end if;
  -- Quem atende (admin, gestor e SDR ativos): é quem a visão da gestão lista.
  if not exists (select 1 from app.avisos_quem_atende() as q (id) where q.id = v_eu) then
    raise exception 'só quem atende registra o navegador' using errcode = '42501';
  end if;
  if p_aparelho is null
     or p_permissao is null
     or p_permissao not in ('liberada', 'a_pedir', 'bloqueada', 'sem_suporte') then
    raise exception 'navegador inválido' using errcode = '22023';
  end if;
  if v_rotulo = '' then
    v_rotulo := 'Navegador';
  end if;

  -- O mesmo estado dentro da hora não regrava: duas abas abrindo juntas, ou a
  -- volta para a aba, não viram uma escrita por vez.
  insert into app.avisos_navegadores as n
    (pessoa_id, aparelho_id, permissao, som_ligado, silenciado, rotulo)
  values
    (v_eu, p_aparelho, p_permissao, coalesce(p_som, true), coalesce(p_silenciado, false), v_rotulo)
  on conflict (pessoa_id, aparelho_id) do update
     set permissao  = excluded.permissao,
         som_ligado = excluded.som_ligado,
         silenciado = excluded.silenciado,
         rotulo     = excluded.rotulo,
         visto_em   = now()
   where (n.permissao, n.som_ligado, n.silenciado, n.rotulo)
           is distinct from (excluded.permissao, excluded.som_ligado, excluded.silenciado, excluded.rotulo)
      or n.visto_em < now() - interval '1 hour';

  -- O que já não conta (30 dias sem sinal), e o teto de 20 por pessoa.
  delete from app.avisos_navegadores n
   where n.pessoa_id = v_eu
     and (n.visto_em < now() - interval '30 days'
          or n.aparelho_id not in (select m.aparelho_id
                                     from app.avisos_navegadores m
                                    where m.pessoa_id = v_eu
                                    order by m.visto_em desc, m.criado_em desc
                                    limit 20));
end $$;
comment on function public.avisos_registrar_navegador(uuid, text, boolean, boolean, text) is
  'O navegador conta se avisa: permissão de notificação, som, silêncio e rótulo, sempre para a pessoa logada. O site chama ao abrir e quando algo muda; o mesmo estado dentro da hora não regrava. Só na Imova.';
revoke all on function public.avisos_registrar_navegador(uuid, text, boolean, boolean, text) from public, anon;
grant execute on function public.avisos_registrar_navegador(uuid, text, boolean, boolean, text) to authenticated;

-- =====================================================================
-- 3. A visão da gestão: quem recebe, e onde
-- =====================================================================
create or replace function public.avisos_quem_recebe()
returns table (
  pessoa_id               uuid,
  nome                    text,
  papel                   text,
  -- Celular: aparelhos com o app, o último sinal, o aviso de mensagem nova e a
  -- chave geral dos avisos no celular.
  celular_aparelhos       integer,
  celular_visto_em        timestamptz,
  celular_mensagem_ligada boolean,
  celular_push_ligado     boolean,
  -- Computador: navegadores com aviso ligado nos últimos 30 dias, o último
  -- sinal de qualquer navegador da pessoa e a lista dos 30 dias.
  computador_ligados      integer,
  computador_visto_em     timestamptz,
  navegadores             jsonb,
  -- celular_e_computador · so_computador · so_celular · nenhum
  situacao                text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not app.admin_ou_gestor() then
    raise exception 'só admin e gestor veem quem recebe os avisos' using errcode = '42501';
  end if;
  -- Na KOMUNE, ninguém (ver o comentário de avisos_registrar_navegador).
  if app.avisos_empresa() = 'komune' then
    return;
  end if;

  return query
  with gente as (
    select p.id, p.full_name, p.role::text as papel
      from app.avisos_quem_atende() as q (id)
      join public.profiles p on p.id = q.id
  ),
  celular as (
    select a.pessoa_id as id, count(*)::integer as aparelhos, max(a.visto_em) as visto_em
      from public.aparelhos_push a
     group by a.pessoa_id
  ),
  computador as (
    select n.pessoa_id as id,
           (count(*) filter (where n.visto_em > now() - interval '30 days'
                               and n.permissao = 'liberada'
                               and not n.silenciado))::integer as ligados,
           max(n.visto_em) as visto_em,
           coalesce(jsonb_agg(jsonb_build_object('rotulo', n.rotulo,
                                                 'permissao', n.permissao,
                                                 'som', n.som_ligado,
                                                 'silenciado', n.silenciado,
                                                 'visto_em', n.visto_em)
                              order by n.visto_em desc)
                      filter (where n.visto_em > now() - interval '30 days'),
                    '[]'::jsonb) as navegadores
      from app.avisos_navegadores n
     group by n.pessoa_id
  ),
  linhas as (
    select g.id, g.full_name, g.papel,
           coalesce(c.aparelhos, 0) as aparelhos,
           c.visto_em as cel_visto,
           not exists (select 1 from public.avisos_desligados d
                        where d.pessoa_id = g.id and d.tipo = 'mensagem') as mensagem_ligada,
           app.avisos_push_ligados() as push_ligado,
           coalesce(k.ligados, 0) as ligados,
           k.visto_em as comp_visto,
           coalesce(k.navegadores, '[]'::jsonb) as navegadores
      from gente g
      left join celular c on c.id = g.id
      left join computador k on k.id = g.id
  ),
  com_situacao as (
    select l.*,
           (l.aparelhos > 0 and l.mensagem_ligada and l.push_ligado) as no_celular,
           (l.ligados > 0) as no_computador
      from linhas l
  )
  select s.id, s.full_name, s.papel,
         s.aparelhos, s.cel_visto, s.mensagem_ligada, s.push_ligado,
         s.ligados, s.comp_visto, s.navegadores,
         case when s.no_celular and s.no_computador then 'celular_e_computador'
              when s.no_computador then 'so_computador'
              when s.no_celular then 'so_celular'
              else 'nenhum' end
    from com_situacao s
   -- Quem não recebe nada primeiro: é por essa linha que a gestão abre a tela.
   order by case when s.no_celular and s.no_computador then 3
                 when s.no_celular or s.no_computador then 2
                 else 1 end,
            s.no_computador desc,
            s.full_name;
end $$;
comment on function public.avisos_quem_recebe() is
  'Ajustes → Avisos (11/11/2026, só na Imova): para cada pessoa ativa que atende, se recebe aviso no celular (app registrado, aviso de mensagem nova e chave avisos.push ligados), em quantos navegadores (permissão liberada, sem silêncio, sinal nos últimos 30 dias) e a situação. Só admin e gestor.';
revoke all on function public.avisos_quem_recebe() from public, anon;
grant execute on function public.avisos_quem_recebe() to authenticated;

  $ddl$;
end $quem$;

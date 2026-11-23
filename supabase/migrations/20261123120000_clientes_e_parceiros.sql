-- =====================================================================
-- Clientes e Parceiros nas Conversas da Imova (23/11/2026)
--
-- Pedido do usuário: "Quero que nas conversas do ambiente da Imova funcione
-- de forma semelhante ao do Komune. Onde temos dentro da aba de conversa dois
-- tipos de perfis: Clientes e Parceiros, onde Clientes são aqueles que entram
-- em contato para perguntar sobre imóveis, terrenos, etc. Já os parceiros são
-- aqueles em que temos algo fechado, por exemplo, inquilinos. Todos os que
-- entram em contato pela primeira vez com a Imova devem entrar como Cliente e
-- devem permanecer por lá até que seja mudado o perfil dele para Parceiro."
--
-- Protótipo aprovado no mesmo dia, com as quatro sugestões:
--   1. a IA que atende NÃO responde Parceiros (ela foi feita para vender);
--   2. negócio ganho NÃO muda o perfil sozinho (a tela só sugere);
--   3. a mudança guarda o tipo de parceria (inquilino, proprietário,
--      comprador ou outro) e, se houver, o imóvel;
--   4. quem atende muda o perfil: admin, gestor e SDR (`app.is_manager()`).
--
-- PARCEIRO É A MARCA DA CONSULTORIA. A Consultoria (14/10/2026) já era "de
-- quem a gente já cuida": uma linha por ficha em `public.consultoria`. Na
-- Imova ela passa a se chamar Parceiros na tela, e a linha ganha o tipo e o
-- imóvel. Não mexe em etapa, funil, relatório nem meta, como antes.
--
-- O QUE MUDA:
--   * `public.consultoria`: colunas `tipo` e `anuncio_id` (nas duas empresas;
--     nulas, então nada do que existe muda). O botão de Prospectados
--     (`consultoria_marcar`) continua pondo a marca sem tipo.
--   * `public.parceiro_mudar`: põe ou tira a marca de UMA ficha, com o tipo e
--     o imóvel, auditado. Só na Imova.
--   * `app.ia_atende`: com a marca, a IA fica quieta. É o mesmo corpo da
--     20261117230000 (a volta depois de 24 h) mais esse passo. Só na Imova.
--   * `public.ia_conversa_estado`: devolve `parceiro`, para a tela explicar
--     por que a IA não responde. Só na Imova.
--
-- Na KOMUNE só as duas colunas entram (nulas): a tela de lá não muda.
--
-- COMO DESFAZER: reaplicar `app.ia_atende` da 20261117230000 e
-- `public.ia_conversa_estado` da 20261110150000; `drop function
-- public.parceiro_mudar(uuid, boolean, text, uuid)`. As colunas podem ficar.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. O tipo e o imóvel da parceria (nas duas empresas)
-- ---------------------------------------------------------------------
alter table public.consultoria
  add column if not exists tipo text,
  add column if not exists anuncio_id uuid;

do $tipo$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'consultoria_tipo_valido'
                    and conrelid = 'public.consultoria'::regclass) then
    alter table public.consultoria
      add constraint consultoria_tipo_valido
      check (tipo is null or tipo in ('inquilino', 'proprietario', 'comprador', 'outro'));
  end if;
  -- O imóvel é um anúncio da Imova. Onde a tabela não existe, a coluna fica
  -- solta (e nula): nada a ligar.
  if to_regclass('public.anuncios') is not null
     and not exists (select 1 from pg_constraint
                      where conname = 'consultoria_anuncio_id_fkey'
                        and conrelid = 'public.consultoria'::regclass) then
    alter table public.consultoria
      add constraint consultoria_anuncio_id_fkey
      foreign key (anuncio_id) references public.anuncios (id) on delete set null;
  end if;
end $tipo$;

comment on column public.consultoria.tipo is
  'Que parceria (Imova, 23/11/2026): inquilino, proprietario, comprador ou outro. Nulo = marca posta sem tipo (o botão de Prospectados, ou antes de 23/11).';
comment on column public.consultoria.anuncio_id is
  'O imóvel da parceria, quando há anúncio (Imova, 23/11/2026). Opcional.';
comment on table public.consultoria is
  'Quem está na aba Consultoria de Conversas por decisão de alguém (14/10/2026). Na Imova, desde 23/11/2026, é o perfil Parceiro (com tipo e imóvel); sem a linha, é Cliente. Quem põe e tira: public.consultoria_marcar (vários, sem tipo) e public.parceiro_mudar (um, com tipo). Não mexe em etapa nem em relatório.';

do $imova$
begin
  if (select i.empresa from app.identidade i) = 'komune' then
    raise notice 'Clientes e Parceiros é da Imova: no banco da KOMUNE só entraram as colunas (nulas).';
    return;
  end if;

  -- -------------------------------------------------------------------
  -- 2. Mudar o perfil de uma ficha
  -- -------------------------------------------------------------------
  execute $ddl$
create or replace function public.parceiro_mudar(
  p_organization_id uuid,
  p_parceiro        boolean,
  p_tipo            text default null,
  p_anuncio_id      uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_antes public.consultoria%rowtype;
  v_era   boolean;
  v_tipo  text := nullif(btrim(coalesce(p_tipo, '')), '');
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  if not app.is_manager() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if p_organization_id is null or not exists (
       select 1 from public.organizations o
        where o.id = p_organization_id and o.deleted_at is null) then
    return jsonb_build_object('ok', false, 'motivo', 'ficha_inexistente');
  end if;

  select * into v_antes from public.consultoria where organization_id = p_organization_id;
  v_era := found;

  if not coalesce(p_parceiro, true) then
    -- Voltar para Clientes: a linha sai. Quem já era Cliente fica como está.
    if not v_era then
      return jsonb_build_object('ok', true, 'mudou', false, 'perfil', 'cliente');
    end if;
    delete from public.consultoria where organization_id = p_organization_id;
    insert into public.audit_log (actor_id, actor_role, action, table_name, row_id, old_data)
    values (v_uid, app.role()::text, 'VOLTOU_PARA_CLIENTES', 'consultoria',
            p_organization_id::text, to_jsonb(v_antes));
    return jsonb_build_object('ok', true, 'mudou', true, 'perfil', 'cliente');
  end if;

  if v_tipo is not null and v_tipo not in ('inquilino', 'proprietario', 'comprador', 'outro') then
    return jsonb_build_object('ok', false, 'motivo', 'tipo_invalido');
  end if;
  if p_anuncio_id is not null and not exists (
       select 1 from public.anuncios a where a.id = p_anuncio_id and a.excluido_em is null) then
    return jsonb_build_object('ok', false, 'motivo', 'anuncio_invalido');
  end if;

  -- Virar Parceiro, ou corrigir o tipo e o imóvel de quem já é: "desde" e
  -- "por" ficam os da primeira vez.
  insert into public.consultoria (organization_id, por, tipo, anuncio_id)
  values (p_organization_id, v_uid, v_tipo, p_anuncio_id)
  on conflict (organization_id) do update
     set tipo = excluded.tipo,
         anuncio_id = excluded.anuncio_id;

  insert into public.audit_log (actor_id, actor_role, action, table_name, row_id, old_data, new_data)
  values (v_uid, app.role()::text,
          case when v_era then 'PARCERIA_CORRIGIDA' else 'VIROU_PARCEIRO' end,
          'consultoria', p_organization_id::text,
          case when v_era then to_jsonb(v_antes) end,
          jsonb_build_object('tipo', v_tipo, 'anuncio_id', p_anuncio_id));
  return jsonb_build_object('ok', true, 'mudou', true, 'perfil', 'parceiro', 'era_parceiro', v_era);
end $$;
comment on function public.parceiro_mudar(uuid, boolean, text, uuid) is
  'Imova, 23/11/2026: muda o perfil de uma ficha nas Conversas. p_parceiro = true põe (ou corrige) a marca de Parceiro em public.consultoria com o tipo (inquilino, proprietario, comprador, outro) e o anúncio; false volta para Clientes. Admin, gestor e SDR (app.is_manager); auditado. Não mexe em etapa nem em relatório.';
revoke all on function public.parceiro_mudar(uuid, boolean, text, uuid) from public, anon;
grant execute on function public.parceiro_mudar(uuid, boolean, text, uuid) to authenticated;
  $ddl$;

  -- -------------------------------------------------------------------
  -- 3. A IA que atende não responde Parceiros
  -- -------------------------------------------------------------------
  execute $ddl$
create or replace function app.ia_atende(p_conversation_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cfg     jsonb := app.ia_atendente_config();
  v_janela  constant interval := interval '24 hours';
  c         public.conversations%rowtype;
  a         public.ia_atendimento%rowtype;
  v_ultima  record;
  v_agora   timestamptz;
  v_desde   timestamptz;
begin
  if not coalesce((v_cfg ->> 'ligada')::boolean, false) then
    return false;
  end if;
  select * into c from public.conversations where id = p_conversation_id;
  if not found or c.channel <> 'whatsapp'::app.channel or c.bloqueada_em is not null then
    return false;
  end if;
  -- O robô pausado (freio do RF-CON-20 ou opt-out): a porteira recusaria.
  if c.bot_paused then
    return false;
  end if;
  -- Parceiro (23/11/2026): quem já fechou com a Imova fala com a equipe.
  if c.organization_id is not null and exists (
       select 1 from public.consultoria k where k.organization_id = c.organization_id) then
    return false;
  end if;
  if c.id is distinct from app.ia_conversa_de_treino()
     and not app.ia_conversa_de_teste(c.id)
     and coalesce(v_cfg ->> 'modo', 'treino') <> 'clientes' then
    return false;
  end if;

  select * into a from public.ia_atendimento where conversation_id = p_conversation_id;
  -- Uma pessoa parou a IA aqui: fica parada até alguém religar.
  if a.estado = 'parada' and a.mudou_por is not null then
    return false;
  end if;

  -- "Agora": a mensagem do cliente que espera resposta (a última da conversa,
  -- quando é dele); sem ela, o momento atual.
  select m.direction, m.created_at into v_ultima
    from public.messages m
   where m.conversation_id = p_conversation_id
     and m.type not in ('reaction'::app.msg_type, 'system'::app.msg_type)
   order by m.created_at desc, m.id desc
   limit 1;
  v_agora := case when v_ultima.direction = 'in'::app.msg_direction then v_ultima.created_at
                  else now() end;

  -- A IA passou para a equipe há menos de 24 h desse "agora": é da equipe.
  if a.estado = 'parada' and a.mudou_em > v_agora - v_janela then
    return false;
  end if;

  -- O time escreveu nas 24 h antes desse "agora" (ou depois dele): é do time.
  -- Mensagem de antes de alguém ligar a IA aqui não conta.
  v_desde := greatest(coalesce(a.mudou_em, '-infinity'::timestamptz), v_agora - v_janela);
  if exists (select 1 from public.messages m
              where m.conversation_id = p_conversation_id
                and m.direction = 'out'::app.msg_direction
                and m.author_kind = 'human'
                and m.created_at > v_desde) then
    return false;
  end if;
  return true;
end $$;
comment on function app.ia_atende(uuid) is
  'A IA que atende (Imova) responde nesta conversa agora? Chave ligada, WhatsApp, não bloqueada, robô não pausado, ficha que não é Parceiro (23/11/2026), do treino, de teste ou modo clientes; não parada por uma pessoa; e nem o time escreveu nem a IA passou para a equipe nas 24 h antes da mensagem do cliente que espera resposta (17/11/2026).';
revoke all on function app.ia_atende(uuid) from public, anon;
grant execute on function app.ia_atende(uuid) to authenticated, service_role;
  $ddl$;

  -- -------------------------------------------------------------------
  -- 4. A tela sabe que é Parceiro
  -- -------------------------------------------------------------------
  execute $ddl$
create or replace function public.ia_conversa_estado(p_conversation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cfg      jsonb := app.ia_atendente_config();
  a          public.ia_atendimento%rowtype;
  v_pausou   boolean;
  v_parceiro boolean;
begin
  if auth.uid() is null or not app.is_manager() then
    return jsonb_build_object('existe', false);
  end if;
  select * into a from public.ia_atendimento where conversation_id = p_conversation_id;
  v_pausou := coalesce((select c.bot_paused from public.conversations c where c.id = p_conversation_id), false)
              and a.estado is distinct from 'parada';
  v_parceiro := exists (select 1 from public.conversations c
                          join public.consultoria k on k.organization_id = c.organization_id
                         where c.id = p_conversation_id);
  return jsonb_build_object(
    'existe', true,
    'ligada', coalesce((v_cfg ->> 'ligada')::boolean, false),
    'modo', v_cfg ->> 'modo',
    'treino', p_conversation_id is not distinct from app.ia_conversa_de_treino(),
    'teste', app.ia_conversa_de_teste(p_conversation_id),
    'atende', app.ia_atende(p_conversation_id),
    'parceiro', v_parceiro,
    'estado', case when v_pausou then 'parada' else a.estado end,
    'motivo', case when v_parceiro
                   then 'É Parceiro: quem responde é a equipe. Para a IA voltar, mude o perfil para Cliente.'
                   when v_pausou
                   then 'O freio do WhatsApp pausou o robô nesta conversa (respostas rápidas ou repetidas demais, ou o cliente pediu para sair). Ligar a IA de novo tira a pausa.'
                   else a.motivo end,
    'mudou_em', a.mudou_em,
    'mudou_por', app.primeiro_nome(a.mudou_por),
    'passada_para', app.primeiro_nome(a.passada_para));
end $$;
revoke all on function public.ia_conversa_estado(uuid) from public, anon;
grant execute on function public.ia_conversa_estado(uuid) to authenticated;
  $ddl$;
end $imova$;

-- =====================================================================
-- 20260909160000 — A cadência ganha porta de entrada
--                  (RF-CON-13..17, RF-FUN-01/03; ADR-03, ADR-05)
--
-- ---------------------------------------------------------------------------
-- O DEFEITO
-- ---------------------------------------------------------------------------
-- `public.matricular_em_cadencia` está no banco desde 04/09. Tem `grant execute`
-- para `authenticated`, tem trinta asserções em pgTAP (17 e 18) e funciona: quem
-- a chama por psql entra numa régua e vê o primeiro toque nascer.
--
-- Ninguém a chama. Nem a tela de Cadências, nem a de Funis, nem a ficha do
-- parceiro, nem o worker, nem nenhum dos catorze jobs do `pg_cron` — os dois da
-- régua (`cadencias_agendar`, `cadencias_encerrar_silencio`) leem
-- `cadence_enrollments`, e essa tabela só ganha linha por esta RPC.
--
-- O efeito é o pior tipo de vazio: um que parece cheio. `cadencias_visao`
-- devolve cinco réguas ligadas, com passos, canais, atrasos e condições — e
-- `matriculas.ativas = 0` em todas, para sempre. Duas telas ("Cadências" e
-- "Resumo do dia") e um item de menu mostram uma máquina montada que nunca vai
-- receber a primeira peça. O cartão da tela chega a dizer "ligada", que é
-- verdade sobre a chave e mentira sobre a porta: não existe porta.
--
-- ---------------------------------------------------------------------------
-- POR QUE A CORREÇÃO É NO BANCO, E NÃO SÓ NA TELA
-- ---------------------------------------------------------------------------
-- Construir a porta é, em princípio, trabalho de tela: um botão que chama a RPC.
-- Só que uma porta precisa de duas coisas que a tela não pode inventar sem
-- reimplementar regra de negócio em TypeScript (ADR-03):
--
--   1. **Ela precisa saber ANTES se vai abrir.** A RPC tem nove recusas
--      nomeadas. Oferecer "Matricular" em cima de um alvo suprimido, de quem já
--      tem cadência ativa ou de quem tem toque pendente é oferecer um caminho
--      que o banco fecha — e a única maneira honesta de a tela saber disso é
--      perguntar ao próprio guarda, com as mesmas checagens e na mesma ordem.
--   2. **Ela precisa saber QUEM pode entrar.** "Matricular alguém" sem uma
--      lista é um campo de busca em branco sobre 100 organizações, das quais a
--      maioria vai ser recusada no envio.
--
-- Então esta migração faz o guarda virar uma pergunta que se pode fazer sem
-- escrever nada, e a `matricular_em_cadencia` passa a ser a casca que faz essa
-- pergunta e, se a resposta for sim, grava. Uma regra, um lugar: se amanhã
-- nascer uma décima recusa, ela nasce em `app.recusa_de_matricula` e as três
-- telas passam a respeitá-la sem uma linha de TypeScript nova.
--
-- ---------------------------------------------------------------------------
-- O QUE ENTRA
-- ---------------------------------------------------------------------------
--   A. `app.pode_matricular()` — o conjunto de papéis que matricula, escrito
--      uma vez (era literal dentro da RPC).
--   B. `app.recusa_de_matricula(org, slug, gancho, deal)` — as nove recusas na
--      ordem original, sem gravar nada. Devolve também o negócio e a pessoa que
--      a matrícula usaria, para quem for gravar não repetir a busca.
--   C. `public.matricular_em_cadencia(...)` reescrita como casca sobre B.
--      MESMA assinatura, MESMOS retornos, MESMA ordem de recusa — os testes 17
--      e 18 continuam valendo palavra por palavra, e é de propósito: uma porta
--      nova não é hora de mexer no guarda.
--   D. `public.cadencias_do_negocio(deal)` — a pergunta da folha de mover do
--      kanban: para ESTE negócio, quais réguas aceitam, quais recusam e por quê.
--   E. `public.negocios_para_cadencia(slug, busca, limite)` — a pergunta da
--      tela de Cadências: para ESTA régua, quem pode entrar agora.
--   F. `public.meu_papel()` — o que o papel de quem está logado faz, dito pelo
--      banco. Existe porque duas telas precisam decidir se OFERECEM um gesto
--      (arrastar um cartão, matricular alguém), e a alternativa era repetir a
--      lista de papéis de `app.can_write()` em TypeScript — a segunda verdade
--      que diverge na primeira vez que alguém mexer no enum.
--
-- ---------------------------------------------------------------------------
-- A ÚNICA REGRA NOVA, E ELA É DE OFERTA — NUNCA DE AUTORIZAÇÃO
-- ---------------------------------------------------------------------------
-- `sugerida` (em D) e o filtro de etapa (em E) respondem "faz sentido oferecer
-- esta régua a este negócio agora?". A resposta sai das flags que o catálogo de
-- etapas já carrega, e não de uma lista de slugs escrita à mão:
--
--   * etapa de saída (`is_won`, `is_lost`, `is_dormant`, `is_terminal`) não puxa
--     régua nova. Matricular quem acabou de ser marcado como perdido, ou de
--     pedir opt-out, é o oposto do guardrail — e a `matricular_em_cadencia`
--     NUNCA olhou a etapa, então sem esta linha a folha de mover ofereceria
--     cadência logo depois de mover o cartão para "Opt-out / não contatar";
--   * a exceção é a régua que EXIGE gancho (hoje só `reativacao`): ela nasce
--     justamente em Nutrição, que é uma etapa de saída — é a régua que devolve
--     ao mundo quem a régua de silêncio arquivou (RF-CON-15).
--
-- Isto é ORDEM DE OFERTA, não permissão: `pode` continua saindo inteiro de
-- `app.recusa_de_matricula`, e uma régua não sugerida continua matriculável se
-- a pessoa escolher. Nenhuma tela ganha poder que o Postgres não tenha dado.
--
-- Nada aqui envia mensagem, cria toque por conta própria ou afrouxa recusa.
-- Idempotente: pode ser reaplicada sem erro e sem perder dados.
-- =====================================================================


-- ===========================================================================
-- A. O CONJUNTO DE PAPÉIS QUE MATRICULA, EM UM LUGAR SÓ
-- ===========================================================================
-- Estava escrito literal dentro de `matricular_em_cadencia`, e agora três
-- funções e duas telas precisam da mesma resposta. `embaixador` fica de fora
-- como já estava: ele registra o que aconteceu na carteira dele, não coloca
-- ninguém numa régua de toques.
create or replace function app.pode_matricular()
returns boolean language sql stable set search_path = '' as $$
  select app.role() in ('admin'::app.user_role, 'gestor'::app.user_role, 'sdr'::app.user_role)
$$;
comment on function app.pode_matricular() is
  'Papéis que matriculam em cadência (admin, gestor, sdr). Espelha a checagem que public.matricular_em_cadencia sempre fez; existe para não haver duas cópias dela.';
revoke all on function app.pode_matricular() from public, anon;
grant execute on function app.pode_matricular() to authenticated, service_role;


-- ===========================================================================
-- B. O GUARDA VIRA PERGUNTA
-- ===========================================================================
-- Cópia fiel das checagens de `public.matricular_em_cadencia` (20260904001801
-- §6), na MESMA ORDEM — a ordem é parte do contrato: a primeira recusa que bate
-- é a que a pessoa lê, e trocar duas de lugar troca a frase que ela vê.
--
-- Não grava, não trava linha e não levanta exceção: `stable`, para poder ser
-- chamada de dentro de um `select` que percorre uma lista de negócios sem
-- transformar uma leitura em escrita.
--
-- O retorno carrega `deal_id` e `contact_id` porque descobrir o negócio e a
-- pessoa É uma das checagens (é a partir da pessoa que sai
-- `toque_pendente_no_contato`), e quem for gravar não pode repetir a busca com
-- outro critério — foi assim que a duplicata de toque por pessoa nasceu uma vez
-- (20260904001801).
create or replace function app.recusa_de_matricula(p_organization_id uuid,
                                                   p_cadence_slug   text,
                                                   p_gancho         text default null,
                                                   p_deal_id        uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c         public.cadences%rowtype;
  v_deal    public.deals%rowtype;
  v_contato uuid;
begin
  if not app.pode_matricular() then
    return jsonb_build_object('motivo', 'sem_permissao');
  end if;

  select * into c from public.cadences where slug = p_cadence_slug and is_active;
  if not found then
    return jsonb_build_object('motivo', 'cadencia_inexistente');
  end if;
  if not exists (select 1 from public.organizations o
                  where o.id = p_organization_id and o.deleted_at is null) then
    return jsonb_build_object('motivo', 'organizacao_inexistente');
  end if;
  if not app.org_is_visible(p_organization_id) then
    return jsonb_build_object('motivo', 'sem_permissao');
  end if;

  if app.is_suppressed_target(p_organization_id, null) then
    return jsonb_build_object('motivo', 'contato_suprimido');
  end if;
  if c.requires_gancho and length(trim(coalesce(p_gancho, ''))) = 0 then
    return jsonb_build_object('motivo', 'gancho_obrigatorio', 'cadence_id', c.id);
  end if;
  if c.requires_authorization and not app.tem_autorizacao_vigente(p_organization_id) then
    return jsonb_build_object('motivo', 'sem_autorizacao');
  end if;
  if exists (select 1 from public.cadence_enrollments e
              where e.organization_id = p_organization_id
                and e.status = 'ativa'::app.cadence_status) then
    return jsonb_build_object('motivo', 'ja_tem_cadencia_ativa');
  end if;
  if exists (select 1 from public.cadence_touches t
              where t.organization_id = p_organization_id
                and t.status = 'pendente'::app.touch_status) then
    return jsonb_build_object('motivo', 'toque_pendente');
  end if;

  select d.* into v_deal from public.deals d
   where d.id = p_deal_id
      or (p_deal_id is null and d.organization_id = p_organization_id and d.status = 'open')
   order by d.created_at limit 1;
  v_contato := v_deal.primary_contact_id;

  if v_contato is not null
     and exists (select 1 from public.cadence_touches t
                  where t.contact_id = v_contato
                    and t.status = 'pendente'::app.touch_status) then
    return jsonb_build_object('motivo', 'toque_pendente_no_contato');
  end if;
  if app.is_suppressed_target(p_organization_id, v_contato) then
    return jsonb_build_object('motivo', 'contato_suprimido');
  end if;

  return jsonb_build_object('motivo', null, 'cadence_id', c.id,
                            'deal_id', v_deal.id, 'contact_id', v_contato);
end $$;
comment on function app.recusa_de_matricula(uuid, text, text, uuid) is
  'As nove recusas de public.matricular_em_cadencia, na mesma ordem, sem gravar nada. Devolve motivo NULL quando a matrícula seria aceita, com o negócio e a pessoa que ela usaria. É o que permite a uma tela oferecer só o que o banco aceita (ADR-03).';
revoke all on function app.recusa_de_matricula(uuid, text, text, uuid) from public, anon;
grant execute on function app.recusa_de_matricula(uuid, text, text, uuid) to authenticated, service_role;


-- ===========================================================================
-- C. A RPC DE SEMPRE, AGORA COMO CASCA
-- ===========================================================================
-- Mesma assinatura, mesmos retornos, mesma auditoria. O que some é a segunda
-- cópia das checagens.
create or replace function public.matricular_em_cadencia(p_organization_id uuid,
                                                         p_cadence_slug text,
                                                         p_gancho text default null,
                                                         p_deal_id uuid default null,
                                                         p_assignee_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_papel   app.user_role;
  v_exame   jsonb;
  v_motivo  text;
  c         public.cadences%rowtype;
  v_deal    public.deals%rowtype;
  v_contato uuid;
  v_enr     uuid;
  v_res     jsonb;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  v_papel := app.role();

  -- Os guardrails devolvem recusa legível em vez de estourar exceção, porque
  -- quem chama é uma tela. O gatilho continua sendo a garantia.
  v_exame  := app.recusa_de_matricula(p_organization_id, p_cadence_slug, p_gancho, p_deal_id);
  v_motivo := v_exame ->> 'motivo';
  if v_motivo is not null then
    return jsonb_build_object('ok', false, 'motivo', v_motivo);
  end if;

  select * into c from public.cadences where id = (v_exame ->> 'cadence_id')::int;
  -- Sem `into strict`: negócio é opcional (organização pode não ter nenhum
  -- aberto), e nesse caso a matrícula nasce sem `deal_id`, como sempre nasceu.
  select * into v_deal from public.deals where id = (v_exame ->> 'deal_id')::uuid;
  v_contato := (v_exame ->> 'contact_id')::uuid;

  insert into public.cadence_enrollments
    (cadence_id, organization_id, deal_id, contact_id, assignee_id, gancho,
     next_due_at, created_by)
  values (c.id, p_organization_id, v_deal.id, v_contato,
          coalesce(p_assignee_id, v_deal.owner_id, v_uid),
          nullif(trim(coalesce(p_gancho, '')), ''), now(), v_uid)
  returning id into v_enr;

  insert into public.audit_log (actor_id, actor_role, action, table_name, row_id, new_data)
  values (v_uid, v_papel::text, 'MATRICULAR', 'cadence_enrollments', v_enr::text,
          jsonb_build_object('cadencia', c.slug, 'organizacao', p_organization_id,
                             'gancho', p_gancho));

  v_res := app.abrir_proximo_toque(v_enr);
  return jsonb_build_object('ok', true, 'enrollment_id', v_enr, 'cadencia', c.slug,
                            'primeiro_toque', v_res);
end $$;
comment on function public.matricular_em_cadencia(uuid, text, text, uuid, uuid) is
  'Matricula uma organização numa cadência. Recusa alvo suprimido, reativação sem gancho, onboarding sem autorização registrada e pessoa que já tem toque pendente em outra organização. Auditada. Desde 20260909160000 as checagens moram em app.recusa_de_matricula, que a tela consulta antes de oferecer o botão.';
revoke all on function public.matricular_em_cadencia(uuid, text, text, uuid, uuid) from public, anon;
grant execute on function public.matricular_em_cadencia(uuid, text, text, uuid, uuid) to authenticated;


-- ===========================================================================
-- D. A PERGUNTA DA FOLHA DE MOVER: E ESTE NEGÓCIO, ENTRA EM QUÊ?
-- ===========================================================================
-- Chamada depois de o cartão mudar de etapa, que é onde a pergunta nasce de
-- verdade: alguém acabou de dizer "este virou Contatado" e a pergunta seguinte
-- é "e agora, quem cobra o retorno?".
--
-- Devolve TODAS as réguas ligadas, com o motivo de recusa de cada uma — e não
-- só as que aceitam. Uma lista que esconde o que recusou obriga a pessoa a
-- adivinhar por que a régua que ela procurava sumiu; com o motivo escrito ela
-- lê "já tem cadência ativa" e para de procurar.
create or replace function public.cadencias_do_negocio(p_deal_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  d       public.deals%rowtype;
  o       public.organizations%rowtype;
  s       public.stages%rowtype;
  v_saida boolean;
  v_res   jsonb;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;

  select * into d from public.deals where id = p_deal_id;
  if not found or not app.org_is_visible(d.organization_id) then
    return jsonb_build_object('ok', false, 'motivo', 'negocio_nao_encontrado');
  end if;
  select * into o from public.organizations
   where id = d.organization_id and deleted_at is null;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'negocio_nao_encontrado');
  end if;
  select * into s from public.stages where id = d.stage_id;
  v_saida := s.is_won or s.is_lost or s.is_dormant or s.is_terminal;

  select jsonb_build_object(
    'ok', true,
    'papel_matricula', app.pode_matricular(),
    'negocio', jsonb_build_object(
      'deal_id',        d.id,
      'organization_id', d.organization_id,
      'organizacao',    o.name,
      'etapa',          s.name,
      'etapa_de_saida', v_saida),
    -- Quantas réguas existem e estão DESLIGADAS. Sem este número, uma lista
    -- curta parece um bug; com ele, a pessoa sabe que alguém fechou a porta.
    'desligadas', (select count(*)::int from public.cadences where not is_active),
    'cadencias', coalesce((
      select jsonb_agg(jsonb_build_object(
               'slug',              c.slug,
               'nome',              c.name,
               'exige_gancho',      c.requires_gancho,
               'exige_autorizacao', c.requires_authorization,
               'nota_de_entrada',   c.entry_note,
               'passos',            (select count(*)::int from public.cadence_steps st
                                      where st.cadence_id = c.id),
               'primeiro_passo',    (select jsonb_build_object('canal', st.channel::text,
                                                               'titulo', st.title)
                                       from public.cadence_steps st
                                      where st.cadence_id = c.id
                                      order by st."position" limit 1),
               'motivo', app.recusa_de_matricula(d.organization_id, c.slug, null, d.id) ->> 'motivo',
               -- Ordem de oferta, nunca permissão: ver o cabeçalho.
               'sugerida', case when c.requires_gancho then s.is_dormant
                                else not v_saida end)
               order by c.id)
        from public.cadences c
       where c.is_active), '[]'::jsonb))
  into v_res;

  return v_res;
end $$;
comment on function public.cadencias_do_negocio(uuid) is
  'Para um negócio, as cadências ligadas com o motivo de recusa de cada uma (app.recusa_de_matricula) e se faz sentido oferecê-la na etapa atual. Leitura pura: é o que a folha de mover do kanban consulta antes de oferecer a matrícula.';
revoke all on function public.cadencias_do_negocio(uuid) from public, anon;
grant execute on function public.cadencias_do_negocio(uuid) to authenticated;


-- ===========================================================================
-- E. A PERGUNTA DA TELA DE CADÊNCIAS: E ESTA RÉGUA, QUEM ENTRA NELA?
-- ===========================================================================
-- O outro lado da mesma porta. Aqui a pessoa escolheu a régua e precisa do
-- alvo — e a lista tem de ser de quem PODE entrar, senão ela vira um catálogo
-- de recusas.
--
-- O filtro barato vem antes do guarda de propósito: o `where` repete, com índice,
-- seis das nove recusas (organização apagada, alvo suprimido, cadência ativa,
-- toque pendente na organização e na pessoa, autorização ausente), e o guarda —
-- que continua sendo a autoridade — roda sobre um punhado de linhas em vez de
-- sobre o funil inteiro. O pré-filtro pega o dobro do pedido porque o guarda
-- ainda pode derrubar linhas: ele enxerga estados que o `where` não repete, e é
-- melhor sobrar candidato do que devolver meia lista.
--
-- `gancho_obrigatorio` NÃO some da lista: não é um "não", é um "escreva o
-- gancho primeiro" (RF-CON-15), e some-lo esvaziaria a régua de reativação
-- inteira sem dizer por quê.
create or replace function public.negocios_para_cadencia(p_cadence_slug text,
                                                         p_q            text default null,
                                                         p_limit        int  default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  c     public.cadences%rowtype;
  v_lim int  := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_q   text := app.search_name(p_q);
  v_res jsonb;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  if not app.pode_matricular() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;

  select * into c from public.cadences where slug = p_cadence_slug and is_active;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'cadencia_inexistente');
  end if;

  with candidatos as (
    select d.id as deal_id, d.organization_id, o.name as organizacao,
           s.name as etapa, p.slug as funil, d.owner_id, d.temperature,
           d.updated_at
      from public.deals d
      join public.organizations o on o.id = d.organization_id and o.deleted_at is null
      join public.stages s        on s.id = d.stage_id
      join public.pipelines p     on p.id = d.pipeline_id
       -- `open` E `nurturing`: quem está em Nutrição tem status 'nurturing' desde
       -- que o gatilho `app.deals_before_write` o pôs lá, e é exatamente ele que a
       -- régua de reativação existe para buscar de volta. Só `open` deixaria a
       -- reativação sem nenhum alvo possível, para sempre. Ganho, perda e pausado
       -- ficam de fora: negócio encerrado não entra em régua.
     where d.status in ('open'::app.deal_status, 'nurturing'::app.deal_status)
       and app.org_is_visible(d.organization_id)
       and (v_q is null or app.search_name(o.name) like '%' || v_q || '%')
       -- A mesma regra de oferta de D: etapa de saída não puxa régua nova, e a
       -- régua de gancho nasce justamente na Nutrição.
       and (case when c.requires_gancho then s.is_dormant
                 else not (s.is_won or s.is_lost or s.is_dormant or s.is_terminal) end)
       and not exists (select 1 from public.cadence_enrollments e
                        where e.organization_id = d.organization_id
                          and e.status = 'ativa'::app.cadence_status)
       and not app.tem_toque_pendente(d.organization_id, d.primary_contact_id)
       and not app.is_suppressed_target(d.organization_id, d.primary_contact_id)
       and (not c.requires_authorization or app.tem_autorizacao_vigente(d.organization_id))
     order by d.updated_at desc
     limit v_lim * 2)
  select jsonb_build_object(
    'ok', true,
    'cadencia', jsonb_build_object(
      'slug',              c.slug,
      'nome',              c.name,
      'exige_gancho',      c.requires_gancho,
      'exige_autorizacao', c.requires_authorization,
      'nota_de_entrada',   c.entry_note),
    'negocios', coalesce((
      select jsonb_agg(x.linha order by x.organizacao)
        from (select jsonb_build_object(
                       'deal_id',         k.deal_id,
                       'organization_id', k.organization_id,
                       'organizacao',     k.organizacao,
                       'etapa',           k.etapa,
                       'funil',           k.funil,
                       'dono',            dir.full_name,
                       'temperatura',     k.temperature::text,
                       'motivo',          g.motivo) as linha,
                     k.organizacao
                from candidatos k
                left join public.team_directory dir on dir.id = k.owner_id
                cross join lateral (
                  select app.recusa_de_matricula(k.organization_id, c.slug, null, k.deal_id)
                         ->> 'motivo' as motivo) g
               where g.motivo is null or g.motivo = 'gancho_obrigatorio'
               order by k.updated_at desc
               limit v_lim) x), '[]'::jsonb))
  into v_res;

  return v_res;
end $$;
comment on function public.negocios_para_cadencia(text, text, int) is
  'Os negócios que PODEM entrar numa cadência agora, conferidos um a um por app.recusa_de_matricula. Aceita busca por nome da organização. gancho_obrigatorio continua na lista: é pedido de campo, não recusa.';
revoke all on function public.negocios_para_cadencia(text, text, int) from public, anon;
grant execute on function public.negocios_para_cadencia(text, text, int) to authenticated;


-- ===========================================================================
-- F. O QUE O MEU PAPEL FAZ, DITO PELO BANCO
-- ===========================================================================
-- O kanban é arrastável hoje para quem `move_deal` recusa por papel (`leitura`,
-- `financeiro`): a pessoa arrasta, solta, o cartão volta e a frase fala de
-- "carteira" — que não é o problema dela. Para a tela desligar o gesto, ela
-- precisa saber o que o papel faz; e a alternativa a esta função era repetir a
-- lista de `app.can_write()` em TypeScript, que é exatamente a segunda verdade
-- que o ADR-03 existe para não deixar nascer.
--
-- Isto NÃO é autorização — quem autoriza é a RLS e a checagem dentro de cada
-- RPC, que continuam intactas. É o que permite à tela não oferecer um gesto
-- que o banco vai recusar.
create or replace function public.meu_papel()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
           'papel',     app.role()::text,
           'escreve',   app.can_write(),
           'gerencia',  app.is_manager(),
           'matricula', app.pode_matricular())
$$;
comment on function public.meu_papel() is
  'O que o papel de quem está logado faz: escreve (app.can_write), gerencia (app.is_manager) e matricula (app.pode_matricular). Para a tela não oferecer gesto que o banco recusa; a autorização continua na RLS e nas RPCs.';
revoke all on function public.meu_papel() from public, anon;
grant execute on function public.meu_papel() to authenticated;

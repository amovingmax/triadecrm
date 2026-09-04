-- ===========================================================================
-- Dois consertos na entrada de contato (migração 001100), os dois no BANCO.
--
-- Requisitos: RF-FUN-12/13 (catálogo de desfechos e janela de recontato),
-- RF-FUN-03/04 (próxima ação e campos por etapa), RF-MET-01/06 (porta aberta
-- exige resultado registrado; registrar em menos de 20 s), RF-CON-18 (opt-out).
-- PRD §5.3 (funil fornecedor), §5.5 (funil produtor), §5.6 (regra de temperatura).
--
-- ---------------------------------------------------------------------------
-- ACHADO 1 — metade da base nunca esquentava
-- ---------------------------------------------------------------------------
-- `interaction_outcomes.target_stage_slug` é UM slug só, e os 34 desfechos da
-- seed foram escritos com o vocabulário do funil fornecedor (a autoverificação da
-- seed, bloco 13, confere os destinos APENAS contra o funil fornecedor). Cinco
-- desses destinos — em_conversa, reuniao_marcada, apresentacao_realizada,
-- autorizou e cadastro_em_andamento — não existem no funil produtor, que tem
-- vocabulário próprio (PRD §5.5). Resultado medido antes deste conserto:
-- registrar "Interessado" numa ligação para um negócio do funil produtor devolvia
-- `etapa_recusa = etapa_fora_do_funil`, a etapa não mudava, `move_deal` não era
-- chamada, logo o negócio não era assumido — e sem dono o
-- `update deals set last_intent` da 001100 não achava linha na política
-- `deals_update`. A intenção não era gravada e a temperatura ficava em frio.
-- Metade das 100 organizações é produtor ou cerimonialista.
--
-- Duas causas, dois consertos:
--
--   1) O destino tem de ser resolvido NO FUNIL DO NEGÓCIO. Escolhi a saída (a) do
--      enunciado — tabela de equivalência — e não (b) repetir slugs. Motivos:
--        * "Demonstração marcada" e "Reunião marcada" NÃO são a mesma etapa: a do
--          produtor é a demo do app e do painel (PRD §5.5, linha 4), a do
--          fornecedor é a apresentação da proposta de captação (§5.3, linha 5).
--          Dar a elas o mesmo slug apagaria a distinção no relatório por funil
--          (RF-REL-02) e no seed.sql, e o `name` continuaria diferente — slug
--          igual com nome diferente é a pior das duas coisas.
--        * Renomear slug de etapa quebra `deal_stage_history`, `stages.slug` já
--          citado em código e a própria seed, que governa as 33 etapas.
--        * A equivalência é entre ETAPAS, não entre desfechos: 5 linhas resolvem
--          os 8 desfechos e qualquer desfecho futuro que aponte para os mesmos
--          destinos, sem tocar no catálogo quando o gestor editar um chip
--          (RF-ADM-02).
--
--   2) `sets_temperature` tem de valer MESMO QUANDO NÃO HÁ ETAPA EQUIVALENTE.
--      A regra do PRD §5.6 é "etapa OU intenção OU recência" — quente por
--      interesse declarado não depende de etapa nenhuma. Hoje dependia, por
--      acidente de RLS. `app.deal_set_intent` (definer, repetindo a autorização do
--      `move_deal`) é o que faltava. Isso conserta também um caso do funil
--      FORNECEDOR que ninguém tinha visto: `lig_atendeu_retorna` não tem etapa de
--      destino e declara morno — em negócio sem dono ele também não esquentava.
--
-- O que a equivalência NÃO faz: inventar etapa. "Em conversa" (fornecedor 4) não
-- tem equivalente no funil produtor — o PRD §5.5 vai de "Respondeu" (3) direto a
-- "Demonstração marcada" (4), e a §5.1 exige critério de entrada verificável, que
-- nenhuma etapa do produtor tem para "humano assumiu e trocou ≥ 2 mensagens".
-- Então `lig_interessado` e `vis_decisor_interessado` continuam sem mover etapa no
-- funil produtor, e esquentam pela intenção — que é exatamente por que esses dois
-- chips declaram `sets_temperature = quente` na seed.
--
-- ---------------------------------------------------------------------------
-- ACHADO 2 — a tela agendava toque em contato suprimido
-- ---------------------------------------------------------------------------
-- `registrar_contato` não olhava `organizations.do_not_contact` nem a
-- `suppression_list` em momento nenhum. Registrar "Enviado, sem resposta" num
-- parceiro com opt-out criava a tarefa "Follow-up D+3" e a devolvia ao "Meu dia"
-- — o CRM recolocava na fila quem pediu para parar, contra o guardrail do
-- CLAUDE.md ("nenhum envio a contato suprimido, em nenhum modo") e o RF-CON-18.
--
-- Escolha: RECUSAR A CONSEQUÊNCIA, NUNCA O REGISTRO. O desfecho continua sendo
-- aceito e a atividade é gravada; o que a função passa a suprimir é tudo o que
-- devolveria a pessoa à fila. Por quê, e não recusar o desfecho:
--   * RF-MET-01 exige resultado registrado para a porta contar. Recusar o chip
--     ensinaria a Heloísa a não registrar nada — e o dado que se perde é
--     justamente a prova de que houve toque em contato suprimido, que é o que a
--     auditoria de LGPD (RF-ADM-03, §10) precisa enxergar.
--   * O guardrail é sobre CONTATAR de novo, não sobre saber. Uma linha em
--     `activities` não é um envio.
--   * A recusa vai NOMEADA no retorno (`etapa_recusa = 'contato_suprimido'` e
--     `contato_suprimido = true`), então a tela vira frase em português em vez de
--     fingir que nada aconteceu.
-- O que fica suprimido, com contato suprimido:
--   * nenhuma tarefa de próxima ação (nem a do `move_deal`, nem a de reserva);
--   * `deals.next_action` não é reescrito;
--   * nenhuma ETAPA DE TRABALHO: só etapa de perda (`is_lost` — Perdido e
--     Opt-out) é aplicada, porque fechar não é trabalhar. "Nutrição" é etapa de
--     RE-CONTATO (reengajar em D+30/D+60, PRD §5.3) e por isso é recusada;
--   * nenhuma intenção que ESQUENTE: só `sets_temperature = 'frio'` passa;
--   * o negócio não é assumido (não se atribui carteira sobre quem não se contata).
--
-- E fecha o buraco pelo outro lado: `app.consent_apply` passa a CANCELAR as
-- tarefas abertas da organização quando o opt-out/eliminação é registrado. Sem
-- isso, a tarefa criada ANTES do opt-out continuava no "Meu dia" de alguém.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Equivalência de etapas entre funis (PRD §5.3 ↔ §5.5)
-- ---------------------------------------------------------------------------
-- `canonical_slug` é o slug como o catálogo de desfechos o escreve (vocabulário do
-- funil fornecedor); `stage_slug` é a etapa que faz esse mesmo papel no funil
-- `pipeline_id`. Só faz sentido cadastrar equivalência para slug que NÃO existe no
-- funil de destino: a resolução prefere sempre o slug literal.
create table if not exists public.stage_equivalences (
  id             bigint generated always as identity primary key,
  pipeline_id    int  not null references public.pipelines(id) on delete cascade,
  canonical_slug text not null check (canonical_slug ~ '^[a-z0-9_]+$'),
  stage_slug     text not null,
  note           text,
  created_at     timestamptz not null default now(),
  unique (pipeline_id, canonical_slug),
  -- A etapa de destino tem de existir NAQUELE funil (stages tem unique (pipeline_id, slug)).
  foreign key (pipeline_id, stage_slug) references public.stages (pipeline_id, slug)
    on update cascade on delete cascade
);
comment on table public.stage_equivalences is
  'Que etapa faz, em cada funil, o papel de uma etapa do vocabulário do catálogo de desfechos (RF-FUN-12). Lida por app.stage_for; catálogo governado pela seed.';
comment on column public.stage_equivalences.canonical_slug is
  'Slug como interaction_outcomes.target_stage_slug o escreve (vocabulário do funil fornecedor).';
comment on column public.stage_equivalences.stage_slug is
  'Etapa equivalente no funil pipeline_id. A resolução prefere o slug literal quando ele existe no funil.';

alter table public.stage_equivalences enable row level security;
drop policy if exists stage_equivalences_select on public.stage_equivalences;
drop policy if exists stage_equivalences_insert on public.stage_equivalences;
drop policy if exists stage_equivalences_update on public.stage_equivalences;
drop policy if exists stage_equivalences_delete on public.stage_equivalences;
-- Catálogo: todo autenticado lê (igual a interaction_outcomes e stages); só gestor edita.
create policy stage_equivalences_select on public.stage_equivalences for select to authenticated
  using (true);
create policy stage_equivalences_insert on public.stage_equivalences for insert to authenticated
  with check ((select app.is_manager()));
create policy stage_equivalences_update on public.stage_equivalences for update to authenticated
  using ((select app.is_manager())) with check ((select app.is_manager()));
create policy stage_equivalences_delete on public.stage_equivalences for delete to authenticated
  using ((select app.is_manager()));

drop trigger if exists audit_stage_equivalences on public.stage_equivalences;
create trigger audit_stage_equivalences after insert or update or delete on public.stage_equivalences
  for each row execute function app.audit();

-- As quatro equivalências que o PRD descreve. A §5.6 alinha explicitamente as
-- faixas ("Quente: ... ou etapas 5–8" do Funil 1, que no Funil 3 são as 4–7), e as
-- tabelas §5.3/§5.5 dizem o resto:
--   reuniao_marcada (F1 5, "data, hora e formato confirmados")
--     ↔ demonstracao_marcada (F3 4, "data e formato")
--   apresentacao_realizada (F1 6, "resultado registrado: interessado/objeção/não")
--     ↔ demonstracao_realizada (F3 5, "mostrou app e painel; dor registrada")
--   autorizou (F1 7, o sim registrado com evidência)
--     ↔ parceria_aceita (F3 6, "aceitou termos e o papel de indicação")
--   cadastro_em_andamento (F1 8, cadastro do parceiro em curso)
--     ↔ parceria_aceita (F3 6), cuja automação declarada É "criação assistida da
--       conta de produtor" e cuja saída é "conta criada".
-- Rejeitei mapear cadastro_em_andamento para evento_piloto_definido (F3 7), que é
-- o par ordinal: o critério de entrada dele é "evento real escolhido (data,
-- público, categorias)", que "cadastro iniciado na hora" não verifica, e a
-- automação de entrada dele abre Research Requests. Seria etapa mentindo e
-- automação disparando por engano. PENDENTE DE DECISÃO HUMANA (Rafael/Heloísa):
-- confirmar que "cadastro iniciado na hora" numa visita a produtor é mesmo
-- "Parceria aceita".
--
-- em_conversa NÃO está aqui de propósito: não existe etapa equivalente no funil
-- produtor (ver o cabeçalho).
insert into public.stage_equivalences (pipeline_id, canonical_slug, stage_slug, note)
select p.id, v.canonical_slug, v.stage_slug, v.note
  from (values
    ('produtor', 'reuniao_marcada',        'demonstracao_marcada',
     'PRD §5.3 linha 5 ↔ §5.5 linha 4: data e formato confirmados.'),
    ('produtor', 'apresentacao_realizada', 'demonstracao_realizada',
     'PRD §5.3 linha 6 ↔ §5.5 linha 5: encontro feito, resultado registrado.'),
    ('produtor', 'autorizou',              'parceria_aceita',
     'PRD §5.3 linha 7 ↔ §5.5 linha 6: o sim registrado.'),
    ('produtor', 'cadastro_em_andamento',  'parceria_aceita',
     'PRD §5.5 linha 6: a automação de "Parceria aceita" é a criação assistida da conta.')
  ) as v(pipeline, canonical_slug, stage_slug, note)
  join public.pipelines p on p.slug = v.pipeline
on conflict (pipeline_id, canonical_slug) do update
  set stage_slug = excluded.stage_slug,
      note       = excluded.note;

-- ---------------------------------------------------------------------------
-- 2. Resolução do destino no funil do negócio
-- ---------------------------------------------------------------------------
-- SECURITY INVOKER: `stages` e `stage_equivalences` são catálogo com select aberto
-- a todo autenticado; não há nada a elevar. Devolve 0 ou 1 linha — 0 significa
-- "este funil não tem etapa para este desfecho", que é recusa honesta.
create or replace function app.stage_for(p_pipeline_id int, p_slug text)
returns setof public.stages
language sql
stable
security invoker
set search_path = ''
as $$
  select s.*
    from public.stages s
   where s.pipeline_id = p_pipeline_id
     and s.slug = case
           when exists (select 1 from public.stages d
                         where d.pipeline_id = p_pipeline_id and d.slug = p_slug)
             then p_slug
           else (select e.stage_slug from public.stage_equivalences e
                  where e.pipeline_id = p_pipeline_id and e.canonical_slug = p_slug)
         end
$$;
comment on function app.stage_for(int, text) is
  'Etapa de destino de um desfecho no funil pedido: o slug literal quando existe nesse funil, senão a equivalência de public.stage_equivalences. Vazio quando o funil não tem equivalente.';
-- `anon` não executa nada em `app` (teste 09_seguranca_acesso), e EXECUTE nasce
-- concedido a PUBLIC: a revogação é obrigatória em toda função nova deste schema.
revoke all on function app.stage_for(int, text) from public, anon;
grant execute on function app.stage_for(int, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Alvo suprimido (guardrail do CLAUDE.md, RF-CON-18, RF-ADM-04)
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER porque sdr e embaixador não leem public.organizations na tabela
-- base (RF-BAS-14): como invoker, a checagem voltaria `false` justamente para quem
-- trabalha no campo, que é o pior falso negativo possível num guardrail. Devolve
-- só um booleano — nenhum dado do parceiro atravessa.
create or replace function app.is_suppressed_target(p_organization_id uuid,
                                                    p_contact_id uuid default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.organizations o
                  where o.id = p_organization_id
                    and (o.do_not_contact
                         or app.is_suppressed(o.phone_e164, o.cnpj, o.instagram_handle)))
      or (p_contact_id is not null
          and exists (select 1 from public.contacts c
                       where c.id = p_contact_id
                         and (c.do_not_contact
                              or app.is_suppressed(c.phone_e164, null, c.instagram_handle))))
$$;
comment on function app.is_suppressed_target(uuid, uuid) is
  'true quando a organização (ou a pessoa do toque) está em do_not_contact ou na suppression_list. Guardrail de RF-CON-18: quem está aqui não recebe tarefa nem etapa de trabalho.';
revoke all on function app.is_suppressed_target(uuid, uuid) from public, anon;
grant execute on function app.is_suppressed_target(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Escrever a intenção do desfecho sem depender do claim do move_deal
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER pelo mesmo motivo do `move_deal` (migração 000900): os negócios
-- da base nasceram com owner_id nulo e a política `deals_update` é
-- `is_manager() or owner_id = auth.uid()`, então ela recusa qualquer escrita em
-- negócio sem dono. A função REPETE a regra da política dentro do corpo, sem
-- afrouxá-la: papel com escrita, visibilidade de `deals_select`, e a mesma
-- ampliação estreita — negócio SEM DONO é do bolo comum e quem o trabalha o assume.
-- `p_claim` existe para o caso do contato suprimido: grava a intenção que ESFRIA
-- sem atribuir carteira sobre quem não se pode contatar.
create or replace function app.deal_set_intent(p_deal_id uuid,
                                               p_intent  text,
                                               p_at      timestamptz,
                                               p_claim   boolean default true)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_role  app.user_role;
  v_deal  public.deals%rowtype;
  v_claim boolean := false;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  if not app.can_write() then
    return false;
  end if;

  select d.* into v_deal from public.deals d where d.id = p_deal_id;
  if not found then
    return false;
  end if;
  if exists (select 1 from public.organizations o
              where o.id = v_deal.organization_id and o.deleted_at is not null) then
    return false;
  end if;

  v_role := app.role();
  -- Visibilidade: cópia da política deals_select.
  if not (app.sees_all()
          or (v_role = 'embaixador'::app.user_role
              and (v_deal.owner_id = v_uid or app.org_is_mine(v_deal.organization_id)))) then
    return false;
  end if;
  -- Escrita: cópia da política deals_update, mais o claim de negócio sem dono.
  v_claim := p_claim and v_deal.owner_id is null;
  if not (app.is_manager() or v_deal.owner_id = v_uid or v_deal.owner_id is null) then
    return false;
  end if;
  if v_role = 'embaixador'::app.user_role and not app.org_is_editable(v_deal.organization_id) then
    return false;
  end if;

  update public.deals d
     set last_intent    = p_intent,
         last_intent_at = p_at,
         owner_id       = case when v_claim then v_uid else d.owner_id end
   where d.id = p_deal_id;

  return v_claim;
end $$;
comment on function app.deal_set_intent(uuid, text, timestamptz, boolean) is
  'Grava deals.last_intent/last_intent_at declarada por um desfecho (RF-FUN-12) para app.compute_temperature reagir (PRD §5.6), repetindo a autorização de move_deal. Devolve true quando assumiu negócio sem dono.';
revoke all on function app.deal_set_intent(uuid, text, timestamptz, boolean) from public, anon;
grant execute on function app.deal_set_intent(uuid, text, timestamptz, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Opt-out cancela o que já estava na fila (RF-CON-18)
-- ---------------------------------------------------------------------------
-- Único acréscimo à função da migração 000400: as tarefas abertas da organização
-- passam a ser canceladas. Sem isso, a tarefa criada ANTES do opt-out continuava
-- no "Meu dia" (RF-MET-04) e o guardrail caía pelo lado do passado. Cancelar (e
-- não apagar) preserva o histórico e a auditoria.
create or replace function app.consent_apply()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_suppress boolean := new.kind in ('contact_optout','erasure_request','erasure_done');
  v_erasure  boolean := new.kind in ('erasure_request','erasure_done');
  v_reason   text := new.kind::text;
  c record;
  o record;
begin
  if v_suppress then
    -- pessoa
    if new.contact_id is not null then
      select * into c from public.contacts where id = new.contact_id;
      if found then
        update public.contacts set do_not_contact = true where id = c.id and not do_not_contact;
        perform app.suppress('phone', c.phone_e164, v_reason, new.channel, new.id);
        perform app.suppress('instagram', c.instagram_handle, v_reason, new.channel, new.id);
      end if;
    end if;

    -- organizações: a do evento + as da pessoa
    for o in
      select org.* from public.organizations org
       where org.id = new.organization_id
          or (new.contact_id is not null and org.id in
                (select oc.organization_id from public.organization_contacts oc where oc.contact_id = new.contact_id))
    loop
      update public.organizations set do_not_contact = true where id = o.id and not do_not_contact;
      perform app.suppress('phone', o.phone_e164, v_reason, new.channel, new.id);
      perform app.suppress('instagram', o.instagram_handle, v_reason, new.channel, new.id);
      if v_erasure then
        perform app.suppress('cnpj', o.cnpj, v_reason, new.channel, new.id);
      end if;

      -- Negócios ainda em andamento vão para a etapa de opt-out do próprio funil.
      update public.deals d
         set stage_id = st.id,
             stage_change_reason = 'Opt-out registrado (' || v_reason || ')'
        from public.stages st
       where d.organization_id = o.id
         and d.status in ('open','paused','nurturing')
         and st.pipeline_id = d.pipeline_id
         and st.is_optout
         and d.stage_id <> st.id;

      -- E o que já estava agendado sai da fila de quem quer que seja.
      update public.tasks t
         set status = 'cancelled'::app.task_status
       where t.organization_id = o.id
         and t.status in ('todo'::app.task_status, 'doing'::app.task_status);
    end loop;

  elsif new.kind = 'contact_optin' then
    if new.contact_id is not null then
      update public.contacts ct set do_not_contact = false
       where ct.id = new.contact_id and ct.do_not_contact
         and not app.is_suppressed(ct.phone_e164, null, ct.instagram_handle);
    end if;
    if new.organization_id is not null then
      update public.organizations org set do_not_contact = false
       where org.id = new.organization_id and org.do_not_contact
         and not app.is_suppressed(org.phone_e164, org.cnpj, org.instagram_handle);
    end if;
  end if;

  return new;
end $$;
comment on function app.consent_apply() is
  'Aplica o evento de consentimento (RF-CON-18, RF-ADM-04): do_not_contact, hashes na suppression_list, negócios abertos para a etapa de opt-out do funil e cancelamento das tarefas abertas da organização.';

-- ---------------------------------------------------------------------------
-- 6. registrar_contato: destino por funil + guardrail de supressão
-- ---------------------------------------------------------------------------
-- Continua sendo a casca fina e SECURITY INVOKER da migração 001100. Mudou:
--   * a etapa de destino é resolvida por `app.stage_for` no funil DO NEGÓCIO
--     (achado 1, causa 1), inclusive na escolha do negócio quando p_deal_id é nulo;
--   * a intenção declarada passa por `app.deal_set_intent` e vale mesmo sem etapa
--     aplicada (achado 1, causa 2);
--   * `app.is_suppressed_target` corta tarefa, etapa de trabalho, reescrita de
--     next_action, claim e intenção que esquenta (achado 2);
--   * o retorno ganha `contato_suprimido` e o valor `contato_suprimido` em
--     `etapa_recusa`. Nenhuma chave existente mudou de nome ou de tipo.
create or replace function public.registrar_contato(
  p_client_key             uuid,
  p_organization_id        uuid,
  p_outcome_id             int,
  p_com_quem               text          default 'nao_informado',
  p_deal_id                uuid          default null,
  p_expected_stage_id      int           default null,
  p_occurred_at            timestamptz   default now(),
  p_body                   text          default null,
  p_duration_min           int           default null,
  p_lost_reason_id         int           default null,
  p_meeting_at             timestamptz   default null,
  p_meeting_format         text          default null,
  p_authorization_evidence text          default null,
  p_next_action_kind       app.task_kind default null,
  p_next_action_title      text          default null,
  p_next_action_at         timestamptz   default null)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid          uuid := auth.uid();
  o              public.interaction_outcomes%rowtype;
  v_surface      app.interaction_surface;
  v_type         app.activity_type;
  v_channel      app.channel;
  v_com_quem     text := coalesce(nullif(trim(p_com_quem), ''), 'nao_informado');
  v_occurred     timestamptz := coalesce(p_occurred_at, now());
  v_deal         public.deals%rowtype;
  v_temp_antes   app.temperature;
  v_etapa_antes  text;
  v_activity     uuid;
  v_meta         jsonb;
  v_repetido     boolean := false;
  v_stage_id     int;
  v_stage        public.stages%rowtype;
  v_tem_etapa    boolean := false;
  v_fields       jsonb := '{}'::jsonb;
  v_next         jsonb;
  v_na_kind      app.task_kind;
  v_na_title     text;
  v_na_at        timestamptz;
  v_move         jsonb;
  v_aplicada     boolean := false;
  v_recusa       text;
  v_recusa_det   jsonb;
  v_claim        boolean := false;
  v_claim_int    boolean := false;
  v_task         uuid;
  v_intent       text;
  v_espera       int;
  v_dia          date;
  v_temp_alvo    app.temperature;
  v_cooldown     timestamptz;
  v_etapa_depois text;
  v_temp_depois  app.temperature;
  v_atencao      boolean := false;
  v_suprimido    boolean := false;
  v_hoje         date := (now() at time zone 'America/Fortaleza')::date;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  if not app.can_write() then
    return jsonb_build_object('registrado', false, 'motivo', 'sem_permissao', 'detalhe', null);
  end if;
  if v_com_quem not in ('decisor', 'influenciador', 'funcionario', 'ninguem', 'nao_informado') then
    v_com_quem := 'nao_informado';
  end if;

  -- ----- o desfecho manda -----
  select * into o from public.interaction_outcomes where id = p_outcome_id and is_active;
  if not found then
    return jsonb_build_object('registrado', false, 'motivo', 'desfecho_invalido', 'detalhe', null);
  end if;

  -- O par (tipo, canal) sai do CATÁLOGO, não do pedido: a tela escolhe o desfecho e
  -- o desfecho já sabe em que superfície vive. Mandar o par pela rede seria pedir à
  -- interface que acertasse a combinação que `app.activities_apply_outcome`
  -- revalida. Os 34 desfechos da seed têm exatamente uma superfície; se um dia um
  -- tiver duas, a derivação deixa de ser determinística e a recusa diz isso.
  if cardinality(o.surfaces) <> 1 then
    return jsonb_build_object('registrado', false, 'motivo', 'desfecho_fora_da_superficie',
                              'detalhe', o.slug);
  end if;
  v_surface := o.surfaces[1];
  select t.tipo, t.canal into v_type, v_channel
    from (values
      ('whatsapp',     'message'::app.activity_type, 'whatsapp'::app.channel),
      ('ligacao',      'call'::app.activity_type,    'phone'::app.channel),
      ('visita',       'visit'::app.activity_type,   'presencial'::app.channel),
      ('reuniao',      'meeting'::app.activity_type, 'presencial'::app.channel),
      ('instagram_dm', 'message'::app.activity_type, 'instagram'::app.channel)
    ) as t(superficie, tipo, canal)
   where t.superficie = v_surface::text;
  if v_type is null then
    return jsonb_build_object('registrado', false, 'motivo', 'desfecho_fora_da_superficie',
                              'detalhe', v_surface::text);
  end if;

  -- ----- o que o desfecho exige antes de qualquer escrita -----
  if o.requires_lost_reason and p_lost_reason_id is null then
    return jsonb_build_object('registrado', false, 'motivo', 'motivo_de_perda_obrigatorio',
                              'detalhe', null);
  end if;
  if o.slug in ('lig_reuniao_marcada', 'reu_reagendada') and p_meeting_at is null then
    return jsonb_build_object('registrado', false, 'motivo', 'reuniao_sem_data', 'detalhe', null);
  end if;
  if o.slug = 'reu_autorizou'
     and nullif(trim(coalesce(p_authorization_evidence, '')), '') is null then
    return jsonb_build_object('registrado', false, 'motivo', 'autorizacao_sem_evidencia',
                              'detalhe', null);
  end if;

  -- ----- o parceiro -----
  -- organizations_view em vez da tabela: a política organizations_select é
  -- `is_manager() or reads_base_pii()`, e sdr não é nenhum dos dois. A view aplica
  -- app.org_is_visible, que é a visibilidade que vale para este papel.
  if not exists (select 1 from public.organizations_view v where v.id = p_organization_id) then
    return jsonb_build_object('registrado', false, 'motivo', 'organizacao_inexistente',
                              'detalhe', null);
  end if;

  -- ----- o negócio -----
  -- Sem `p_deal_id`, escolhe o negócio aberto da organização, preferindo o funil em
  -- que o desfecho TEM destino — agora pela resolução por funil (app.stage_for), e
  -- não mais pelo slug literal, que só existia no vocabulário do fornecedor.
  if p_deal_id is not null then
    select d.* into v_deal from public.deals d where d.id = p_deal_id;
  else
    select d.* into v_deal
      from public.deals d
     where d.organization_id = p_organization_id
       and d.status = 'open'::app.deal_status
     order by (o.target_stage_slug is not null
               and exists (select 1 from app.stage_for(d.pipeline_id, o.target_stage_slug))) desc,
              d.last_activity_at desc nulls last,
              d.created_at
     limit 1;
  end if;
  if found then
    v_temp_antes  := v_deal.temperature;
    select s.name into v_etapa_antes from public.stages s where s.id = v_deal.stage_id;
  end if;

  -- ----- o guardrail (RF-CON-18, CLAUDE.md) -----
  -- Calculado ANTES de qualquer consequência e depois do negócio, porque a pessoa
  -- do toque é a `primary_contact_id` dele. Não impede o registro — só apaga tudo o
  -- que devolveria este alvo à fila.
  --
  -- Olha as DUAS organizações. `p_organization_id` e `p_deal_id` são argumentos
  -- independentes e a função nunca exigiu que combinassem: a tela sempre manda o par
  -- coerente, mas quem chama a RPC por fora (a chave anônima mais uma sessão qualquer)
  -- podia mandar uma organização limpa em `p_organization_id` e o NEGÓCIO de uma
  -- organização suprimida em `p_deal_id`. O guardrail olhava só a primeira, devolvia
  -- `contato_suprimido = false` e criava a tarefa no negócio de quem pediu para parar
  -- — o mesmo achado da conferência, pela porta dos fundos. Medido antes deste
  -- conserto: tarefa "Marcar apresentação" para 08/09 no negócio da organização
  -- suprimida, negócio assumido e temperatura frio → quente.
  v_suprimido := app.is_suppressed_target(p_organization_id, v_deal.primary_contact_id)
                 or (v_deal.organization_id is not null
                     and v_deal.organization_id is distinct from p_organization_id
                     and app.is_suppressed_target(v_deal.organization_id,
                                                  v_deal.primary_contact_id));

  -- ----- a atividade (RF-MET-06) -----
  -- Só `com_quem` e `client_key` vão no metadata pela mão: `outcome_slug`,
  -- `door_opened`, `door_knocked` e `cooldown_until` quem escreve é o gatilho
  -- `app.activities_apply_outcome`, e `deals.last_activity_at` é o
  -- `app.activities_touch_deal`.
  begin
    insert into public.activities
      (type, channel, organization_id, contact_id, deal_id, user_id, occurred_at,
       duration_min, body, outcome_id, metadata)
    values
      (v_type, v_channel, p_organization_id, v_deal.primary_contact_id, v_deal.id, v_uid,
       v_occurred,
       case when v_type = 'meeting'::app.activity_type then p_duration_min end,
       nullif(trim(coalesce(p_body, '')), ''),
       o.id,
       jsonb_build_object('com_quem', v_com_quem, 'client_key', p_client_key::text))
    returning id, metadata into v_activity, v_meta;
  exception when unique_violation then
    -- Reenvio da fila offline: a atividade já está gravada. Devolve o estado de
    -- agora, sem duplicar nada e sem mexer no negócio de novo.
    v_repetido := true;
    select a.id, a.metadata into v_activity, v_meta
      from public.activities a
     where a.metadata ->> 'client_key' = p_client_key::text;
  end;

  -- ----- o lado do negócio -----
  if not v_repetido and v_deal.id is not null then

    -- Etapa de destino, resolvida NO FUNIL DESTE NEGÓCIO (achado 1).
    if o.target_stage_slug is not null then
      select * into v_stage from app.stage_for(v_deal.pipeline_id, o.target_stage_slug);
      v_tem_etapa := found;
      if not v_tem_etapa then
        -- Recusa honesta, não erro: o registro de campo já está gravado e este
        -- funil não tem etapa equivalente (o caso de "Em conversa" no produtor).
        v_recusa := 'etapa_fora_do_funil';
      elsif v_suprimido and not v_stage.is_lost then
        -- Guardrail: etapa de trabalho é fila. Só fechar (Perdido, Opt-out) passa.
        v_tem_etapa := false;
        v_recusa    := 'contato_suprimido';
      end if;
    end if;

    -- A próxima ação sai do catálogo quando o pedido não a trouxe. A régua é a do
    -- RF-MET-06 aplicada à temperatura resultante (D+1 quente, D+3 morno, D+7 frio),
    -- em dias CORRIDOS (a mesma unidade de cooldown_days), pousando no próximo dia
    -- útil às 09:00 de Fortaleza. Espelha `prazoSugerido` em components/registro/tipos.ts;
    -- na prática a tela sempre manda o valor já calculado e isto é a rede de segurança.
    -- Com contato suprimido não há próxima ação NENHUMA — nem a que veio no pedido.
    if v_suprimido then
      v_na_kind := null; v_na_title := null; v_na_at := null;
    else
      v_na_kind  := coalesce(p_next_action_kind, o.next_action_kind);
      v_na_title := nullif(trim(coalesce(p_next_action_title, o.next_action_label, '')), '');
      v_na_at    := p_next_action_at;
      if o.next_action_kind is not null and v_na_at is null then
        v_temp_alvo := coalesce(
          o.sets_temperature,
          case when v_tem_etapa then v_stage.temperature end,
          v_temp_antes, 'frio'::app.temperature);
        v_espera := coalesce(o.next_action_offset_days,
                             case v_temp_alvo when 'quente' then 1 when 'morno' then 3 else 7 end);
        if v_espera = 0 then
          v_na_at := v_occurred + interval '15 minutes';
        else
          v_dia := (v_occurred at time zone 'America/Fortaleza')::date + v_espera;
          for i in 1..14 loop
            exit when extract(isodow from v_dia) < 6
                      and not exists (select 1 from public.holidays h where h.date = v_dia);
            v_dia := v_dia + 1;
          end loop;
          v_na_at := (v_dia + time '09:00') at time zone 'America/Fortaleza';
        end if;
      end if;
      if v_na_at is not null and v_na_title is not null then
        v_next := jsonb_build_object('kind', v_na_kind::text, 'label', v_na_title,
                                     'at', v_na_at);
      end if;
    end if;

    -- Movimento de etapa.
    if v_tem_etapa then
      v_stage_id := v_stage.id;
      if p_lost_reason_id is not null then
        v_fields := v_fields || jsonb_build_object('lost_reason_id', p_lost_reason_id);
      end if;
      if p_meeting_at is not null then
        v_fields := v_fields || jsonb_build_object('meeting_at', p_meeting_at);
      end if;
      if p_meeting_format is not null then
        v_fields := v_fields || jsonb_build_object('meeting_format', p_meeting_format);
      end if;
      if p_authorization_evidence is not null then
        v_fields := v_fields
                    || jsonb_build_object('authorization_evidence', p_authorization_evidence);
      end if;

      v_move := public.move_deal(v_deal.id, v_stage_id, p_expected_stage_id,
                                 o.name || ' (' || v_surface::text || ')', v_fields, v_next);
      if (v_move ->> 'ok')::boolean then
        v_aplicada := true;
        v_claim    := coalesce((v_move ->> 'claimed')::boolean, false);
        v_task     := nullif(v_move ->> 'task_id', '')::uuid;
      else
        v_recusa := case v_move ->> 'reason'
                      when 'negocio_nao_encontrado' then 'etapa_fora_do_funil'
                      when 'etapa_de_outro_funil'   then 'etapa_fora_do_funil'
                      else v_move ->> 'reason'
                    end;
        -- Os campos que faltaram viajam junto: as opções de `meeting_format` são
        -- DIFERENTES por funil ("meet"/"visita" no fornecedor, "meet_manha"/
        -- "cafe_ou_visita_tarde"/"evento_demo_sabado" no produtor), e sem isto a tela
        -- não teria como pedir o formato certo ao resolver a etapa no funil do negócio.
        v_recusa_det := v_move -> 'missing';
      end if;
    end if;

    -- Tarefa da próxima ação quando o `move_deal` não a criou (desfecho sem etapa de
    -- destino, ou etapa recusada). RF-FUN-03 não deixa negócio aberto sem próxima ação,
    -- e "não atendeu" precisa deixar a ligação de amanhã na fila dela. Contato
    -- suprimido nunca chega aqui: v_na_at é nulo desde o começo do bloco.
    if v_task is null and v_na_at is not null and v_na_title is not null then
      insert into public.tasks (title, kind, due_at, assignee_id, organization_id,
                                deal_id, contact_id, created_by, origin)
      values (left(v_na_title, 200), coalesce(v_na_kind, 'follow_up'::app.task_kind), v_na_at,
              coalesce(v_deal.owner_id, v_uid), p_organization_id, v_deal.id,
              v_deal.primary_contact_id, v_uid, 'system')
      returning id into v_task;

      -- `deals.next_action` é a cópia denormalizada que o cartão do kanban e a lista
      -- de parceiros mostram; quando quem cria a tarefa é o `move_deal`, ele já a
      -- sincroniza. Aqui a tarefa nasceu fora dele, então a cópia é atualizada à mão —
      -- e só quando a nova ação é a MAIS PRÓXIMA, que é a que interessa a quem olha o
      -- cartão. Passa pela RLS como qualquer update: em negócio sem dono não acha
      -- linha, e aí a tarefa continua valendo (ela é da pessoa, não do cartão).
      update public.deals d
         set next_action    = left(v_na_title, 200),
             next_action_at = v_na_at
       where d.id = v_deal.id
         and (d.next_action_at is null
              or d.next_action_at > v_na_at
              or (d.next_action_at at time zone 'America/Fortaleza')::date < v_hoje);
    end if;

    -- Intenção: a outra entrada que `app.compute_temperature` lê (o ramo v_hot/v_warm).
    -- O catálogo declara `sets_temperature` em desfechos que a etapa sozinha não
    -- explicaria (`lig_interessado` e `vis_decisor_interessado` levam a `em_conversa`,
    -- que é morno, mas valem quente; `lig_atendeu_retorna` não tem etapa e vale morno).
    -- Escrever a intenção é como esse "quente" chega à regra oficial (PRD §5.6) sem
    -- reimplementá-la — e por isso NÃO depende de a etapa ter sido aplicada: no funil
    -- produtor não existe "Em conversa", e era aí que metade da base ficava fria.
    -- `app.deal_set_intent` é definer e repete a autorização do `move_deal`; sem ele o
    -- update não achava linha em negócio sem dono.
    -- Com contato suprimido, só passa intenção que ESFRIA, e sem assumir o negócio.
    if o.sets_temperature is not null
       and not (v_suprimido and o.sets_temperature <> 'frio'::app.temperature) then
      v_intent := case o.sets_temperature
                    when 'quente' then 'interessado'
                    when 'morno'  then 'quer_saber_mais'
                    else 'agora_nao'
                  end;
      v_claim_int := app.deal_set_intent(v_deal.id, v_intent, v_occurred, not v_suprimido);
      v_claim     := v_claim or v_claim_int;
    end if;
  end if;

  -- ----- estado depois (a autoridade é o banco, nunca a previsão da tela) -----
  if v_deal.id is not null then
    select s.name, d.temperature, d.needs_attention
      into v_etapa_depois, v_temp_depois, v_atencao
      from public.deals d join public.stages s on s.id = d.stage_id
     where d.id = v_deal.id;
    select c.cooldown_until into v_cooldown
      from public.v_contact_cooldown c where c.organization_id = p_organization_id;
    select t.due_at, t.title into v_na_at, v_na_title
      from public.tasks t where t.id = v_task;
  end if;

  return jsonb_build_object(
    'registrado',         true,
    'repetido',           v_repetido,
    'activity_id',        v_activity,
    'deal_id',            v_deal.id,
    'task_id',            v_task,
    'outcome_slug',       o.slug,
    'etapa_antes',        v_etapa_antes,
    'etapa_depois',       v_etapa_depois,
    'etapa_aplicada',     v_aplicada,
    'etapa_recusa',       v_recusa,
    'etapa_recusa_campos',v_recusa_det,
    'etapa_destino_id',   v_stage_id,
    'assumiu_negocio',    v_claim,
    'temperatura_antes',  v_temp_antes,
    'temperatura_depois', v_temp_depois,
    'precisa_atencao',    coalesce(v_atencao, false),
    'porta_aberta',       coalesce((v_meta ->> 'door_opened')::boolean, false),
    'porta_batida',       coalesce((v_meta ->> 'door_knocked')::boolean, false),
    'cooldown_ate',       v_cooldown,
    'contato_suprimido',  v_suprimido,
    'proxima_acao_em',    case when v_task is not null then v_na_at end,
    'proxima_acao_titulo',case when v_task is not null then v_na_title end,
    'sem_negocio',        v_deal.id is null);
end $$;

comment on function public.registrar_contato(uuid, uuid, int, text, uuid, int, timestamptz, text,
                                             int, int, timestamptz, text, text, app.task_kind,
                                             text, timestamptz) is
  'Registra um contato em uma chamada (RF-MET-06): grava a atividade com o desfecho do catálogo (RF-FUN-12), resolve a etapa de destino no funil do próprio negócio (app.stage_for, PRD §5.3/§5.5), delega o movimento ao public.move_deal (RF-FUN-03/04), cria a tarefa da próxima ação e escreve a intenção declarada mesmo sem etapa equivalente. Em contato suprimido (do_not_contact ou suppression_list) o registro continua sendo gravado, mas sem tarefa, sem etapa de trabalho e sem intenção que esquente (RF-CON-18). Idempotente pela chave do cliente. Recusa prevista volta como {registrado:false, motivo}.';

revoke all on function public.registrar_contato(uuid, uuid, int, text, uuid, int, timestamptz, text,
                                                int, int, timestamptz, text, text, app.task_kind,
                                                text, timestamptz) from public, anon;
grant execute on function public.registrar_contato(uuid, uuid, int, text, uuid, int, timestamptz, text,
                                                   int, int, timestamptz, text, text, app.task_kind,
                                                   text, timestamptz) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Limpeza única: o que ficou na fila antes deste conserto
-- ---------------------------------------------------------------------------
-- O gatilho acima só vale para opt-out registrado de agora em diante. Quem já
-- estava em `do_not_contact` quando esta migração rodou continua com tarefas
-- abertas no "Meu dia" de alguém — inclusive a "Follow-up D+3" que a conferência
-- adversarial provocou. Cancelar (não apagar) preserva o histórico.
update public.tasks t
   set status = 'cancelled'::app.task_status
  from public.organizations o
 where o.id = t.organization_id
   and o.do_not_contact
   and t.status in ('todo'::app.task_status, 'doing'::app.task_status);

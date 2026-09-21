-- =====================================================================
-- Fase 2 — O funil: lead automático e valor da oportunidade
--
-- Decisão do Rafael em 21/09/2026: "quem escreve pela primeira vez vira lead
-- sozinho no funil" (captação de fornecedor) e as etapas continuam as nossas,
-- só a exibição fica mais simples. O quadro já recolhe as colunas de
-- encerramento e já conta cada coluna; o que faltava era o VALOR.
--
-- O QUE ENTRA (só acréscimos)
--   1. `deals.valor` e `public.definir_valor_do_negocio`.
--   2. `public.pipeline_board` devolve o valor de cada cartão e a soma da coluna.
--   3. O LEAD AUTOMÁTICO: número desconhecido que escreve vira parceiro, contato
--      e negócio no funil de captação — pela MESMA função que o botão "Criar
--      ficha" da aba "Fora da base" usa (dedup por telefone, supressão, funil
--      pelo tipo). Com uma cortesia: com o menu automático ligado, espera a
--      pessoa escolher, e só cria se ela disse que quer ser fornecedor ou
--      parceiro (ou escreveu com as próprias palavras). Quem quer organizar um
--      evento é cliente do app, não parceiro, e continua em "Fora da base".
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. O valor
-- ---------------------------------------------------------------------
alter table public.deals
  add column if not exists valor numeric(12, 2) check (valor is null or valor >= 0);
comment on column public.deals.valor is
  'Valor estimado da oportunidade, em reais (Fase 2). Opcional; soma por coluna no quadro.';

create or replace function public.definir_valor_do_negocio(p_deal_id uuid, p_valor numeric)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.deals%rowtype;
begin
  if auth.uid() is null or not app.can_write() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  select * into d from public.deals where id = p_deal_id;
  if not found or not (app.sees_all() or d.owner_id = auth.uid() or app.org_is_visible(d.organization_id)) then
    return jsonb_build_object('ok', false, 'motivo', 'negocio_inexistente');
  end if;
  if p_valor is not null and (p_valor < 0 or p_valor > 9999999999) then
    return jsonb_build_object('ok', false, 'motivo', 'valor_invalido');
  end if;
  update public.deals set valor = round(p_valor, 2), updated_at = now() where id = d.id;
  return jsonb_build_object('ok', true, 'valor', round(p_valor, 2));
end $$;

revoke all on function public.definir_valor_do_negocio(uuid, numeric) from public, anon;
grant execute on function public.definir_valor_do_negocio(uuid, numeric) to authenticated;

-- ---------------------------------------------------------------------
-- 2. O quadro com valor (recriado a partir da definição viva; o que mudou
--    está marcado com "NOVO")
-- ---------------------------------------------------------------------
create or replace function public.pipeline_board(p_pipeline_id integer, p_only_mine boolean default false,
                                                 p_owner_id uuid default null, p_q text default null,
                                                 p_stage_id integer default null,
                                                 p_limit_per_stage integer default 40,
                                                 p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_uid      uuid := auth.uid();
  v_sees_all boolean;
  v_emb      boolean;
  v_limit    int  := least(greatest(coalesce(p_limit_per_stage, 40), 1), 200);
  v_offset   int  := greatest(coalesce(p_offset, 0), 0);
  v_name     text := app.search_name(nullif(trim(coalesce(p_q, '')), ''));
  v_owner    uuid := case when coalesce(p_only_mine, false) then v_uid else p_owner_id end;
  v_pipeline record;
  v_board    jsonb;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  v_sees_all := app.sees_all();
  v_emb      := app.role() = 'embaixador'::app.user_role;

  select p.id, p.slug, p.name, p.kind into v_pipeline
    from public.pipelines p where p.id = p_pipeline_id;
  if v_pipeline.id is null then
    raise exception 'Funil % não existe', p_pipeline_id using errcode = '23503';
  end if;

  with visiveis as (
    -- NOVO: o valor entra no cartão e na conta da coluna.
    select c.deal_id, c.stage_id, c.organization_name, c.next_action_at, c.next_action_state,
           c.card || jsonb_build_object('valor', d.valor) as card,
           d.valor
      from app.deal_cards c
      join public.deals d on d.id = c.deal_id
     where c.pipeline_id = p_pipeline_id
       and c.org_deleted_at is null
       and (v_sees_all
            or (v_emb
                and (c.owner_id = v_uid
                     or exists (select 1 from public.organizations o2
                                 where o2.id = c.organization_id and o2.owner_id = v_uid)
                     or exists (select 1 from public.deals d2
                                 where d2.organization_id = c.organization_id and d2.owner_id = v_uid))))
       and (v_owner is null or c.owner_id = v_owner)
       and (v_name is null
            or c.search_name like v_name || '%'
            or c.search_name operator(extensions.%) v_name)
  ),
  numerados as (
    select v.stage_id, v.card, v.valor,
           count(*) over (partition by v.stage_id) as total_na_etapa,
           sum(v.valor) over (partition by v.stage_id) as valor_na_etapa,
           row_number() over (
             partition by v.stage_id
             order by case v.next_action_state
                        when 'sem'      then 0
                        when 'atrasada' then 1
                        when 'hoje'     then 2
                        else 3
                      end,
                      v.next_action_at nulls first,
                      v.organization_name,
                      v.deal_id) as rn
      from visiveis v
  ),
  por_etapa as (
    select n.stage_id,
           max(n.total_na_etapa) as total,
           max(n.valor_na_etapa) as valor_total,
           coalesce(
             jsonb_agg(n.card order by n.rn) filter (
               where (p_stage_id is null or n.stage_id = p_stage_id)
                 and n.rn >  (case when p_stage_id is null then 0 else v_offset end)
                 and n.rn <= (case when p_stage_id is null then 0 else v_offset end) + v_limit),
             '[]'::jsonb) as cards
      from numerados n
     group by n.stage_id
  )
  select jsonb_build_object(
           'pipeline', jsonb_build_object(
              'id', v_pipeline.id, 'slug', v_pipeline.slug,
              'name', v_pipeline.name, 'kind', v_pipeline.kind),
           'generated_at', now(),
           'stages', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'id',              s.id,
                      'slug',            s.slug,
                      'name',            s.name,
                      'position',        s.position,
                      'temperature',     s.temperature,
                      'sla_hours',       s.sla_hours,
                      'is_won',          s.is_won,
                      'is_lost',         s.is_lost,
                      'is_dormant',      s.is_dormant,
                      'is_optout',       s.is_optout,
                      'is_terminal',     s.is_terminal,
                      'required_fields', s.required_fields,
                      'total',           coalesce(e.total, 0),
                      'valor_total',     e.valor_total,
                      'cards',           coalesce(e.cards, '[]'::jsonb))
                    order by s.position)
               from public.stages s
               left join por_etapa e on e.stage_id = s.id
              where s.pipeline_id = p_pipeline_id), '[]'::jsonb))
    into v_board;

  return v_board;
end $function$;

-- ---------------------------------------------------------------------
-- 3. O lead automático
-- ---------------------------------------------------------------------
update public.app_settings
   set value = value || jsonb_build_object('lead_automatico', true)
 where key = 'atendimento' and not (value ? 'lead_automatico');

-- "(84) 99999-0001" para número do Brasil; o E.164 cru para os outros.
create or replace function app.telefone_legivel(p_e164 text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_e164 ~ '^\+55[1-9][0-9]9[0-9]{8}$' then
      '(' || substr(p_e164, 4, 2) || ') ' || substr(p_e164, 6, 5) || '-' || substr(p_e164, 11, 4)
    when p_e164 ~ '^\+55[1-9][0-9][0-9]{8}$' then
      '(' || substr(p_e164, 4, 2) || ') ' || substr(p_e164, 6, 4) || '-' || substr(p_e164, 10, 4)
    else p_e164
  end
$$;

create or replace function app.lead_automatico(p_conversation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c         public.conversations%rowtype;
  v_bot     jsonb := (select s.value from public.app_settings s where s.key = 'whatsapp.bot_de_entrada');
  v_intencao text;
  v_papel   text;
  v_antes   text := current_setting('request.jwt.claims', true);
  v_ret     jsonb;
  v_exist   uuid;
begin
  select * into c from public.conversations where id = p_conversation_id;
  if not found or c.organization_id is not null or c.channel <> 'whatsapp'::app.channel then
    return jsonb_build_object('criou', false, 'motivo', 'ja_tem_ficha');
  end if;
  if not coalesce((select (s.value ->> 'lead_automatico')::boolean from public.app_settings s
                    where s.key = 'atendimento'), false) then
    return jsonb_build_object('criou', false, 'motivo', 'desligado');
  end if;

  -- Com o menu automático ligado, espera a escolha — e só cria para quem quer
  -- ser parceiro, ou para quem respondeu com as próprias palavras.
  if coalesce((v_bot ->> 'ativo')::boolean, false) then
    if c.bot_estado is null or c.bot_estado = 'menu_enviado' then
      return jsonb_build_object('criou', false, 'motivo', 'esperando_o_menu');
    end if;
    if c.bot_estado = 'escolhido' then
      select o ->> 'intencao' into v_intencao
        from jsonb_array_elements(coalesce(v_bot -> 'opcoes', '[]'::jsonb)) o
       where o ->> 'chave' = c.bot_opcao;
      if coalesce(v_intencao, '') <> 'parceria' then
        return jsonb_build_object('criou', false, 'motivo', 'nao_e_parceiro');
      end if;
    end if;
  end if;

  select p.role::text into v_papel from public.profiles p
   where p.id = c.assignee_id and p.is_active;
  if v_papel is null or v_papel not in ('admin', 'gestor', 'sdr', 'embaixador') then
    return jsonb_build_object('criou', false, 'motivo', 'atendente_sem_permissao');
  end if;

  -- As mesmas regras do cadastro rápido (`quick_create_organization`): quem
  -- pediu para sair não entra, e número que a base já conhece — da ficha ou de
  -- uma pessoa ligada a ela — é LIGADO, nunca duplicado. A diferença é uma só:
  -- sem categoria, porque quem acabou de escrever "oi" ainda não disse o que faz.
  if app.is_suppressed(c.peer_phone_e164) then
    return jsonb_build_object('criou', false, 'motivo', 'telefone_suprimido');
  end if;
  select o.id into v_exist from public.organizations o
   where o.phone_e164 = c.peer_phone_e164 and o.deleted_at is null limit 1;
  if v_exist is null then
    select oc.organization_id into v_exist
      from public.contacts ct
      join public.organization_contacts oc on oc.contact_id = ct.id
      join public.organizations o on o.id = oc.organization_id and o.deleted_at is null
     where ct.phone_e164 = c.peer_phone_e164 and ct.deleted_at is null
     order by oc.is_primary desc limit 1;
  end if;

  if v_exist is null then
    insert into public.organizations (kind, name, phone_e164, source_id, collected_at, collector, owner_id)
    values ('fornecedor'::app.org_kind,
            'Contato do WhatsApp ' || app.telefone_legivel(c.peer_phone_e164),
            c.peer_phone_e164,
            (select s.id from public.sources s where s.slug = 'whatsapp_entrada'),
            now(), 'lead automático do WhatsApp', c.assignee_id)
    returning id into v_exist;
    -- Escreveu para a gente: o negócio nasce em "Respondeu", com a próxima ação
    -- de responder agora.
    insert into public.deals (organization_id, pipeline_id, stage_id, owner_id, source_id,
                              next_action, next_action_at)
    select v_exist, p.id, st.id, c.assignee_id,
           (select s.id from public.sources s where s.slug = 'whatsapp_entrada'),
           'Responder no WhatsApp', now()
      from public.pipelines p
      join public.stages st on st.pipeline_id = p.id and st.slug = 'respondeu'
     where p.slug = 'fornecedor';
    insert into public.activities (type, organization_id, user_id, author_kind, body, metadata)
    values ('system', v_exist, c.assignee_id, 'system',
            'Lead criado sozinho: escreveu pela primeira vez no WhatsApp',
            jsonb_build_object('origin', 'lead_automatico', 'conversation_id', c.id));
    v_ret := jsonb_build_object('criada', true);
  else
    v_ret := jsonb_build_object('ligou_a_existente', true);
  end if;

  -- Ligar a conversa à ficha é o mesmo "Ligar a uma ficha" da aba "Fora da
  -- base", feito por quem atende: ele carimba as mensagens e leva a resposta
  -- ao funil.
  perform set_config('request.jwt.claims',
                     jsonb_build_object('sub', c.assignee_id, 'role', 'authenticated',
                                        'app_metadata', jsonb_build_object('app_role', v_papel))::text,
                     true);
  begin
    v_ret := v_ret || public.vincular_conversa(c.id, v_exist);
  exception when others then
    perform set_config('request.jwt.claims', coalesce(v_antes, ''), true);
    raise;
  end;
  perform set_config('request.jwt.claims', coalesce(v_antes, ''), true);

  return jsonb_build_object('criou', coalesce((v_ret ->> 'criada')::boolean, false)) || v_ret;
end $$;

create or replace function app.messages_lead_automatico()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform app.lead_automatico(new.conversation_id);
  exception when others then
    -- A mensagem que chegou vale mais que a ficha criada a partir dela.
    raise warning 'lead_automatico(%): %', new.conversation_id, sqlerrm;
  end;
  return null;
end $$;

-- `zz`: os gatilhos AFTER da mesma tabela disparam em ordem de nome, e este
-- precisa rodar DEPOIS do menu automático (`messages_bot_de_entrada`), que é
-- quem decide se a pessoa já escolheu.
create trigger messages_zz_lead_automatico
  after insert on public.messages
  for each row when (new.direction = 'in'::app.msg_direction)
  execute function app.messages_lead_automatico();

revoke all on function app.telefone_legivel(text) from public, anon, authenticated;
revoke all on function app.lead_automatico(uuid) from public, anon, authenticated;
revoke all on function app.messages_lead_automatico() from public, anon, authenticated;

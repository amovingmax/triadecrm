-- =====================================================================
-- Envios em massa pelo WhatsApp do CRM
--
-- Decisão do Rafael em 21/09/2026: "seria pra tudo, dependendo da situação que
-- eu escolher, e precisa ser amplamente personalizável". Isto revoga, por
-- decisão dele, a recusa 22 do PRD §13 ("campanha e lote como unidade de
-- trabalho") e tira do congelador o essencial do RF-CON-09 — com uma diferença
-- que é o coração deste arquivo:
--
-- ===========================================================================
-- O LOTE NÃO TEM PORTA PRÓPRIA
-- ===========================================================================
-- Cada mensagem do lote sai pela MESMA função que o botão da conversa usa
-- (`public.wa_enviar_modelo`) ou pelo mesmo insert que a caixa de resposta faz,
-- assinada pela pessoa escolhida. O relógio (`app.envios_em_massa_rodar`) veste
-- o crachá dela antes de cada envio — `request.jwt.claims` com o id e o papel —
-- e a porteira inteira confere como se ela tivesse clicado: supressão, janela
-- de 8h às 17h45, teto de primeiros contatos do dia, 150 por dia, 60 por hora,
-- modelo aprovado na Meta fora da janela de 24 h. Nenhuma regra é duplicada
-- aqui, e por isso nenhuma pode divergir.
--
-- O que é NOVO, e só existe no lote:
--   * o ritmo: N por hora, com intervalo sorteado entre 70% e 130% do passo;
--   * a espera: bateu no teto ou na janela, o lote dorme até a próxima
--     abertura (com até 10 min de sorteio, para não disparar tudo às 8h00);
--   * a cortesia: quem recebeu mensagem nossa sem responder nas últimas 72 h
--     fica de fora — duas frias seguidas é o que derruba a nota do número;
--   * a parada automática: 3 ou mais pessoas pediram para sair E isso passa de
--     2% do enviado (RF-CON-10) → o lote para e espera alguém olhar.
--
-- Quem cria lote: admin e gestor. Quem ASSINA: qualquer pessoa ativa que
-- escreve — mas a mensagem só sai se a porteira aceitar essa pessoa.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Tabelas
-- ---------------------------------------------------------------------
create table public.envios_em_massa (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null check (length(btrim(nome)) between 1 and 120),
  tipo          text not null check (tipo in ('modelo', 'texto')),
  modelo_id     int references public.message_templates (id),
  texto         text check (texto is null or length(texto) between 1 and 1000),
  -- {"nome": {"campo": "nome", "reserva": "tudo bem"}, "evento": {"fixo": "Feira de Noivas"}}
  variaveis     jsonb not null default '{}'::jsonb,
  filtro        jsonb not null default '{}'::jsonb,
  assinatura    text not null check (assinatura in ('eu', 'responsavel', 'revezar')),
  atendentes    uuid[] not null default '{}',
  por_hora      int not null check (por_hora between 1 and 60),
  inicio        timestamptz not null default now(),
  proximo_em    timestamptz not null default now(),
  status        text not null default 'agendado'
                check (status in ('agendado', 'enviando', 'pausado', 'parado', 'concluido', 'cancelado')),
  motivo_parada text,
  criado_por    uuid not null references public.profiles (id),
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  concluido_em  timestamptz,
  -- A parada automática conta só o que saiu depois disto; retomar um lote
  -- parado reinicia a contagem (quem retoma já viu as saídas anteriores).
  contar_desde  timestamptz not null default now(),
  constraint envios_em_massa_conteudo check (
    (tipo = 'modelo' and modelo_id is not null and texto is null)
    or (tipo = 'texto' and texto is not null and modelo_id is null))
);
comment on table public.envios_em_massa is
  'Envio em massa pelo WhatsApp (decisão do Rafael, 21/09/2026). Cada item sai pela porteira de sempre, assinado por uma pessoa; o lote só acrescenta ritmo, espera e parada automática.';

create table public.envios_em_massa_itens (
  id              bigint generated always as identity primary key,
  envio_id        uuid not null references public.envios_em_massa (id) on delete cascade,
  posicao         int not null,
  organization_id uuid not null references public.organizations (id),
  assinante_id    uuid not null references public.profiles (id),
  status          text not null default 'pendente'
                  check (status in ('pendente', 'enviada', 'pulada', 'cancelada')),
  motivo          text,
  message_id      uuid references public.messages (id),
  processado_em   timestamptz,
  unique (envio_id, organization_id)
);
create index envios_em_massa_itens_fila on public.envios_em_massa_itens (envio_id, posicao)
  where status = 'pendente';
create index envios_em_massa_rodando on public.envios_em_massa (proximo_em)
  where status in ('agendado', 'enviando');

create table public.publicos_salvos (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null check (length(btrim(nome)) between 1 and 80),
  filtro     jsonb not null,
  criado_por uuid not null references public.profiles (id) default auth.uid(),
  criado_em  timestamptz not null default now()
);
comment on table public.publicos_salvos is
  'Filtros de público reusáveis dos envios em massa. Guarda o FILTRO, não a lista: o público é recalculado a cada uso.';

alter table public.envios_em_massa enable row level security;
alter table public.envios_em_massa_itens enable row level security;
alter table public.publicos_salvos enable row level security;

-- Leitura para admin e gestor; escrita só pelas funções abaixo.
create policy envios_em_massa_select on public.envios_em_massa
  for select to authenticated using (app.is_manager());
create policy envios_em_massa_itens_select on public.envios_em_massa_itens
  for select to authenticated using (app.is_manager());
create policy publicos_salvos_select on public.publicos_salvos
  for select to authenticated using (app.is_manager());
create policy publicos_salvos_insert on public.publicos_salvos
  for insert to authenticated with check (app.is_manager() and criado_por = auth.uid());
create policy publicos_salvos_delete on public.publicos_salvos
  for delete to authenticated using (app.is_manager());

grant select on public.envios_em_massa, public.envios_em_massa_itens to authenticated;
grant select, insert, delete on public.publicos_salvos to authenticated;

create trigger audit_envios_em_massa after insert or update or delete on public.envios_em_massa
  for each row execute function app.audit();

-- ---------------------------------------------------------------------
-- 2. O público: quem entra no filtro, e em que situação cada um está
-- ---------------------------------------------------------------------
-- Filtro (todas as chaves opcionais; listas são "qualquer um de"):
--   situacoes      text[]  nunca_contatado · sem_resposta · ja_conversou ·
--                          janela_aberta · cadastrado_komune
--   tipos          text[]  fornecedor · produtor · cerimonialista · espaco · empresa · outro
--   funis          int[]   pipeline_id de um negócio em aberto
--   etapas         int[]   stage_id de um negócio em aberto
--   categorias     int[]
--   cidades        int[]
--   responsaveis   uuid[]
--   temperaturas   text[]
--   tags           int[]
--   sem_contato_ha_dias int  última mensagem nossa há pelo menos N dias (ou nunca)
--   busca          text    nome contém
create or replace function app.envio_publico(p_filtro jsonb)
returns table (
  organization_id uuid, nome text, tipo text, categoria text, cidade text,
  etapa text, responsavel text, temperatura text, situacao text,
  cadastrado_komune boolean, ultimo_envio timestamptz, bloqueio text)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  f        jsonb := coalesce(p_filtro, '{}'::jsonb);
  v_numero text  := app.wa_numero_padrao();
  v_sit    text[] := array(select jsonb_array_elements_text(f -> 'situacoes'));
  v_tipos  text[] := array(select jsonb_array_elements_text(f -> 'tipos'));
  v_funis  int[]  := array(select jsonb_array_elements_text(f -> 'funis')::int);
  v_etapas int[]  := array(select jsonb_array_elements_text(f -> 'etapas')::int);
  v_cats   int[]  := array(select jsonb_array_elements_text(f -> 'categorias')::int);
  v_cids   int[]  := array(select jsonb_array_elements_text(f -> 'cidades')::int);
  v_resp   uuid[] := array(select jsonb_array_elements_text(f -> 'responsaveis')::uuid);
  v_temps  text[] := array(select jsonb_array_elements_text(f -> 'temperaturas'));
  v_tags   int[]  := array(select jsonb_array_elements_text(f -> 'tags')::int);
  v_dias   int    := nullif(f ->> 'sem_contato_ha_dias', '')::int;
  v_busca  text   := nullif(btrim(coalesce(f ->> 'busca', '')), '');
begin
  return query
  with base as (
    select o.*, d.telefone, d.contact_id as contato_id
      from public.organizations o
      cross join lateral app.wa_destino_da_ficha(o.id) d
     where o.deleted_at is null
       and o.anonymized_at is null
       and app.org_is_visible(o.id)
       and (cardinality(v_tipos) = 0 or o.kind::text = any (v_tipos))
       and (cardinality(v_cids)  = 0 or o.city_id = any (v_cids))
       and (cardinality(v_resp)  = 0 or o.owner_id = any (v_resp))
       and (cardinality(v_temps) = 0 or o.temperature::text = any (v_temps))
       and (v_busca is null or o.search_name like '%' || app.search_name(v_busca) || '%')
       and (cardinality(v_cats) = 0 or exists (
             select 1 from public.organization_categories oc
              where oc.organization_id = o.id and oc.category_id = any (v_cats)))
       and (cardinality(v_tags) = 0 or exists (
             select 1 from public.organization_tags ot
              where ot.organization_id = o.id and ot.tag_id = any (v_tags)))
       and ((cardinality(v_funis) = 0 and cardinality(v_etapas) = 0) or exists (
             select 1 from public.deals dl
              where dl.organization_id = o.id and dl.status = 'open'::app.deal_status
                and (cardinality(v_funis)  = 0 or dl.pipeline_id = any (v_funis))
                and (cardinality(v_etapas) = 0 or dl.stage_id = any (v_etapas))))
  ),
  com_conversa as (
    select b.*, c.id as conversa_id, c.last_inbound_at,
           app.janela_de_24h_aberta(c.id, now()) as janela,
           (select max(coalesce(m.sent_at, m.created_at)) from public.messages m
             where m.conversation_id = c.id and m.direction = 'out'::app.msg_direction
               and m.status <> 'failed'::app.msg_status) as ultimo_out
      from base b
      left join public.conversations c
        on c.channel = 'whatsapp'::app.channel and c.business_number = v_numero
       and c.peer_phone_e164 = b.telefone
  ),
  classificado as (
    select cc.*,
           case when cc.janela then 'janela_aberta'
                when cc.last_inbound_at is not null then 'ja_conversou'
                when cc.ultimo_out is not null then 'sem_resposta'
                else 'nunca_contatado' end as sit,
           (cc.komune_supplier_id is not null or exists (
              select 1 from public.pre_registrations pr
               where pr.organization_id = cc.id
                 and (pr.claimed_at is not null or pr.published))) as na_komune
      from com_conversa cc
  )
  select k.id, k.name, k.kind::text,
         (select c.name from public.organization_categories oc
            join public.categories c on c.id = oc.category_id
           where oc.organization_id = k.id order by oc.is_primary desc, oc.created_at limit 1),
         (select ci.name from public.cities ci where ci.id = k.city_id),
         (select s.name from public.deals dl join public.stages s on s.id = dl.stage_id
           where dl.organization_id = k.id and dl.status = 'open'::app.deal_status
           order by dl.updated_at desc limit 1),
         (select p.full_name from public.profiles p where p.id = k.owner_id),
         k.temperature::text,
         k.sit, k.na_komune, k.ultimo_out,
         case when k.telefone is null then 'sem_whatsapp'
              else app.wa_motivo_de_recusa(k.id, k.contato_id, k.telefone) end
    from classificado k
   where (cardinality(v_sit) = 0
          or k.sit = any (v_sit)
          or ('cadastrado_komune' = any (v_sit) and k.na_komune)
          -- "já conversou" inclui quem está com a janela aberta: ter a janela
          -- aberta é ter conversado há menos de 24 h.
          or ('ja_conversou' = any (v_sit) and k.sit = 'janela_aberta'))
     and (v_dias is null or k.ultimo_out is null or k.ultimo_out < now() - make_interval(days => v_dias))
   order by k.name
   limit 2000;
end $$;

create or replace function public.envio_em_massa_publico(p_filtro jsonb)
returns setof jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not app.is_manager() then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;
  return query select to_jsonb(p) from app.envio_publico(p_filtro) p;
end $$;

-- ---------------------------------------------------------------------
-- 3. A mensagem de UMA pessoa: valores, parâmetros e o corpo final
-- ---------------------------------------------------------------------
-- Campos que uma variável pode puxar da ficha. `atendente` e `saudacao` não
-- estão aqui porque não são escolha: vêm sempre de quem assina e do relógio.
create or replace function app.envio_campos_da_ficha(p_organization_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'nome',      (select d.primeiro_nome from app.wa_destino_da_ficha(o.id) d),
    'empresa',   o.name,
    'categoria', (select lower(c.name) from public.organization_categories oc
                    join public.categories c on c.id = oc.category_id
                   where oc.organization_id = o.id order by oc.is_primary desc, oc.created_at limit 1),
    'cidade',    (select ci.name from public.cities ci where ci.id = o.city_id),
    'origem',    (select s.name from public.sources s
                   where s.id = o.source_id and s.kind in ('scrape'::app.source_kind, 'api'::app.source_kind))))
    from public.organizations o where o.id = p_organization_id
$$;

-- Devolve {ok, parametros, corpo} ou {ok:false, motivo}.
create or replace function app.envio_montar(p_tipo text, p_modelo_id int, p_texto text,
                                            p_variaveis jsonb, p_organization_id uuid,
                                            p_assinante uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_base   text;
  v_campos jsonb := app.envio_campos_da_ficha(p_organization_id);
  v_conf   jsonb;
  v_var    text;
  v_valor  text;
  v_params jsonb := '{}'::jsonb;
  v_todos  jsonb;
begin
  if p_tipo = 'modelo' then
    select t.body into v_base from public.message_templates t where t.id = p_modelo_id;
  else
    v_base := p_texto;
  end if;
  if v_base is null then
    return jsonb_build_object('ok', false, 'motivo', 'modelo_inexistente');
  end if;

  foreach v_var in array coalesce(app.modelo_variaveis(v_base), '{}'::text[]) loop
    continue when v_var in ('atendente', 'saudacao');
    v_conf := p_variaveis -> v_var;
    if v_conf is null then
      return jsonb_build_object('ok', false, 'motivo', 'variavel_sem_regra', 'variavel', v_var);
    end if;
    if v_conf ? 'fixo' then
      v_valor := app.modelo_parametro_limpo(v_conf ->> 'fixo');
    else
      v_valor := coalesce(app.modelo_parametro_limpo(v_campos ->> (v_conf ->> 'campo')),
                          app.modelo_parametro_limpo(v_conf ->> 'reserva'));
    end if;
    if v_valor is null then
      return jsonb_build_object('ok', false, 'motivo', 'sem_valor', 'variavel', v_var);
    end if;
    v_params := v_params || jsonb_build_object(v_var, v_valor);
  end loop;

  v_todos := v_params || jsonb_build_object('atendente', app.primeiro_nome(p_assinante),
                                            'saudacao', app.saudacao_do_momento());
  return jsonb_build_object('ok', true, 'parametros', v_params,
                            'corpo', app.modelo_renderizar(v_base, v_todos));
end $$;

-- ---------------------------------------------------------------------
-- 4. Criar, ver a prévia, pausar, retomar, cancelar
-- ---------------------------------------------------------------------
create or replace function app.envio_assinante(p_modo text, p_atendentes uuid[], p_posicao int,
                                               p_dono uuid, p_quem_cria uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case p_modo
    when 'eu' then p_quem_cria
    when 'responsavel' then coalesce(
      (select p.id from public.profiles p where p.id = p_dono and p.is_active), p_quem_cria)
    else p_atendentes[1 + (p_posicao % cardinality(p_atendentes))]
  end
$$;

create or replace function public.envio_em_massa_previa(p_config jsonb, p_organizacoes uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_eu    uuid := auth.uid();
  v_org   uuid;
  v_i     int := 0;
  v_ass   uuid;
  v_linha jsonb;
  v_itens jsonb := '[]'::jsonb;
  v_modo  text := coalesce(p_config ->> 'assinatura', 'eu');
  v_atds  uuid[] := array(select jsonb_array_elements_text(coalesce(p_config -> 'atendentes', '[]'))::uuid);
begin
  if v_eu is null or not app.is_manager() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if v_modo = 'revezar' and cardinality(v_atds) = 0 then
    v_modo := 'eu';
  end if;
  foreach v_org in array coalesce(p_organizacoes, '{}'::uuid[]) loop
    exit when v_i >= 200;
    v_ass := app.envio_assinante(v_modo, v_atds, v_i,
                                 (select o.owner_id from public.organizations o where o.id = v_org), v_eu);
    v_linha := app.envio_montar(p_config ->> 'tipo', (p_config ->> 'modelo_id')::int,
                                p_config ->> 'texto', coalesce(p_config -> 'variaveis', '{}'),
                                v_org, v_ass);
    v_itens := v_itens || jsonb_build_array(
                 jsonb_build_object('organization_id', v_org,
                                    'assinante', app.primeiro_nome(v_ass)) || v_linha);
    v_i := v_i + 1;
  end loop;
  return jsonb_build_object('ok', true, 'itens', v_itens);
end $$;

create or replace function public.envio_em_massa_criar(p_config jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_eu      uuid := auth.uid();
  v_tipo    text := p_config ->> 'tipo';
  v_modelo  int  := nullif(p_config ->> 'modelo_id', '')::int;
  v_texto   text := nullif(btrim(coalesce(p_config ->> 'texto', '')), '');
  v_vars    jsonb := coalesce(p_config -> 'variaveis', '{}'::jsonb);
  v_modo    text := coalesce(p_config ->> 'assinatura', 'eu');
  v_atds    uuid[] := array(select distinct x::uuid
                              from jsonb_array_elements_text(coalesce(p_config -> 'atendentes', '[]')) x);
  -- Sem repetição, e NA ORDEM em que a tela mandou: a ordem é a fila.
  v_orgs    uuid[] := array(select x.v::uuid
                              from jsonb_array_elements_text(coalesce(p_config -> 'organizacoes', '[]'))
                                   with ordinality x(v, n)
                             group by x.v order by min(x.n));
  v_hora    int  := coalesce(nullif(p_config ->> 'por_hora', '')::int, 20);
  v_inicio  timestamptz := coalesce(nullif(p_config ->> 'inicio', '')::timestamptz, now());
  v_nome    text := btrim(coalesce(p_config ->> 'nome', ''));
  t         public.message_templates%rowtype;
  v_var     text;
  v_conf    jsonb;
  v_id      uuid;
  v_org     uuid;
  v_i       int := 0;
begin
  if v_eu is null or not app.is_manager() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if length(v_nome) not between 1 and 120 then
    return jsonb_build_object('ok', false, 'motivo', 'nome_invalido');
  end if;
  if v_tipo not in ('modelo', 'texto') then
    return jsonb_build_object('ok', false, 'motivo', 'tipo_invalido');
  end if;

  if v_tipo = 'modelo' then
    select * into t from public.message_templates
     where id = v_modelo and is_active and channel = 'whatsapp'::app.channel;
    if not found or t.template_code like 'GEN-SYS-%' then
      return jsonb_build_object('ok', false, 'motivo', 'modelo_inexistente');
    end if;
    if not coalesce((app.wa_modelo_da_meta(t.id) ->> 'aprovado')::boolean, false) then
      return jsonb_build_object('ok', false, 'motivo', 'modelo_nao_aprovado_na_meta');
    end if;
    v_texto := null;
  else
    if v_texto is null or length(v_texto) > 1000 then
      return jsonb_build_object('ok', false, 'motivo', 'texto_invalido');
    end if;
    v_modelo := null;
  end if;

  -- Toda variável precisa de uma regra, e a regra precisa fazer sentido.
  foreach v_var in array coalesce(app.modelo_variaveis(coalesce(t.body, v_texto)), '{}'::text[]) loop
    continue when v_var in ('atendente', 'saudacao');
    v_conf := v_vars -> v_var;
    if v_conf is null
       or (v_conf ? 'fixo' and app.modelo_parametro_limpo(v_conf ->> 'fixo') is null)
       or (not v_conf ? 'fixo'
           and coalesce(v_conf ->> 'campo', '') not in ('nome', 'empresa', 'categoria', 'cidade', 'origem')) then
      return jsonb_build_object('ok', false, 'motivo', 'variavel_sem_regra', 'variavel', v_var);
    end if;
    if length(coalesce(v_conf ->> 'fixo', v_conf ->> 'reserva', '')) > app.modelo_teto_da_variavel(v_var) then
      return jsonb_build_object('ok', false, 'motivo', 'variavel_longa_demais', 'variavel', v_var);
    end if;
  end loop;

  if cardinality(v_orgs) = 0 then
    return jsonb_build_object('ok', false, 'motivo', 'publico_vazio');
  end if;
  if cardinality(v_orgs) > 2000 then
    return jsonb_build_object('ok', false, 'motivo', 'publico_grande_demais');
  end if;
  if v_hora not between 1 and 60 then
    return jsonb_build_object('ok', false, 'motivo', 'ritmo_invalido');
  end if;
  if v_inicio > now() + interval '30 days' then
    return jsonb_build_object('ok', false, 'motivo', 'inicio_distante_demais');
  end if;
  if v_modo not in ('eu', 'responsavel', 'revezar') then
    return jsonb_build_object('ok', false, 'motivo', 'assinatura_invalida');
  end if;
  if v_modo = 'revezar' then
    if cardinality(v_atds) = 0 or exists (
         select 1 from unnest(v_atds) a
          where not exists (select 1 from public.profiles p
                             where p.id = a and p.is_active
                               and p.role in ('admin', 'gestor', 'sdr', 'embaixador'))) then
      return jsonb_build_object('ok', false, 'motivo', 'atendente_invalido');
    end if;
  else
    v_atds := '{}';
  end if;

  insert into public.envios_em_massa (nome, tipo, modelo_id, texto, variaveis, filtro, assinatura,
                                      atendentes, por_hora, inicio, proximo_em, criado_por)
  values (v_nome, v_tipo, v_modelo, v_texto, v_vars, coalesce(p_config -> 'filtro', '{}'),
          v_modo, v_atds, v_hora, v_inicio, greatest(v_inicio, now()), v_eu)
  returning id into v_id;

  foreach v_org in array v_orgs loop
    continue when not exists (select 1 from public.organizations o
                               where o.id = v_org and o.deleted_at is null and app.org_is_visible(o.id));
    insert into public.envios_em_massa_itens (envio_id, posicao, organization_id, assinante_id)
    values (v_id, v_i, v_org,
            app.envio_assinante(v_modo, v_atds, v_i,
                                (select o.owner_id from public.organizations o where o.id = v_org), v_eu));
    v_i := v_i + 1;
  end loop;

  if v_i = 0 then
    delete from public.envios_em_massa where id = v_id;
    return jsonb_build_object('ok', false, 'motivo', 'publico_vazio');
  end if;
  return jsonb_build_object('ok', true, 'id', v_id, 'itens', v_i);
end $$;

create or replace function public.envio_em_massa_mudar(p_id uuid, p_acao text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.envios_em_massa%rowtype;
begin
  if auth.uid() is null or not app.is_manager() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  select * into e from public.envios_em_massa where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'envio_inexistente');
  end if;

  if p_acao = 'pausar' and e.status in ('agendado', 'enviando') then
    update public.envios_em_massa set status = 'pausado', atualizado_em = now() where id = p_id;
  elsif p_acao = 'retomar' and e.status in ('pausado', 'parado') then
    -- Retomar um lote PARADO é decisão consciente: quem retoma leu o motivo.
    -- A contagem da parada automática recomeça a partir daqui.
    update public.envios_em_massa
       set status = 'enviando', motivo_parada = null, proximo_em = now(), atualizado_em = now(),
           contar_desde = case when e.status = 'parado' then now() else contar_desde end
     where id = p_id;
  elsif p_acao = 'cancelar' and e.status not in ('concluido', 'cancelado') then
    update public.envios_em_massa
       set status = 'cancelado', atualizado_em = now(), concluido_em = now() where id = p_id;
    update public.envios_em_massa_itens
       set status = 'cancelada', processado_em = now()
     where envio_id = p_id and status = 'pendente';
  else
    return jsonb_build_object('ok', false, 'motivo', 'acao_invalida_no_estado', 'status', e.status);
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------
-- 5. O acompanhamento
-- ---------------------------------------------------------------------
create or replace function public.envios_em_massa_lista()
returns setof jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not app.is_manager() then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;
  return query
  select jsonb_build_object(
           'id', e.id, 'nome', e.nome, 'tipo', e.tipo, 'status', e.status,
           'motivo_parada', e.motivo_parada, 'por_hora', e.por_hora,
           'inicio', e.inicio, 'proximo_em', e.proximo_em, 'criado_em', e.criado_em,
           'concluido_em', e.concluido_em,
           'criado_por', app.primeiro_nome(e.criado_por),
           'modelo', (select t.name from public.message_templates t where t.id = e.modelo_id),
           'contagem', app.envio_contagem(e.id))
    from public.envios_em_massa e
   order by e.criado_em desc
   limit 100;
end $$;

-- Os números de um lote. "Saiu" = a pessoa, depois de receber, está suprimida
-- ou pediu para parar o marketing (erro 131050 da Meta).
create or replace function app.envio_contagem(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with i as (
    select it.*, m.status as msg_status, m.error_code, m.sent_at, c.last_inbound_at,
           c.peer_phone_e164, m.contact_id
      from public.envios_em_massa_itens it
      left join public.messages m on m.id = it.message_id
      left join public.conversations c on c.id = m.conversation_id
     where it.envio_id = p_id
  )
  select jsonb_build_object(
    'total',      count(*),
    'pendentes',  count(*) filter (where status = 'pendente'),
    'enviadas',   count(*) filter (where status = 'enviada'),
    'puladas',    count(*) filter (where status = 'pulada'),
    'canceladas', count(*) filter (where status = 'cancelada'),
    'entregues',  count(*) filter (where msg_status in ('delivered'::app.msg_status, 'read'::app.msg_status)),
    'lidas',      count(*) filter (where msg_status = 'read'::app.msg_status),
    'falharam',   count(*) filter (where msg_status = 'failed'::app.msg_status),
    'responderam', count(*) filter (where status = 'enviada' and last_inbound_at is not null
                                      and last_inbound_at > coalesce(sent_at, processado_em)),
    'sairam',     count(*) filter (where status = 'enviada' and (
                     error_code = '131050'
                     or app.wa_motivo_de_recusa(organization_id, contact_id, peer_phone_e164) is not null)))
    from i
$$;

create or replace function public.envio_em_massa_detalhe(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  e public.envios_em_massa%rowtype;
begin
  if auth.uid() is null or not app.is_manager() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  select * into e from public.envios_em_massa where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'envio_inexistente');
  end if;
  return jsonb_build_object(
    'ok', true,
    'envio', to_jsonb(e) || jsonb_build_object(
               'criado_por_nome', app.primeiro_nome(e.criado_por),
               'modelo', (select t.name from public.message_templates t where t.id = e.modelo_id),
               'contagem', app.envio_contagem(e.id)),
    'itens', coalesce((
      select jsonb_agg(jsonb_build_object(
               'posicao', it.posicao, 'organization_id', it.organization_id,
               'nome', o.name, 'assinante', app.primeiro_nome(it.assinante_id),
               'status', it.status, 'motivo', it.motivo, 'processado_em', it.processado_em,
               'conversa_id', m.conversation_id,
               'mensagem', m.status, 'erro', m.error_code,
               'respondeu', c.last_inbound_at is not null
                            and c.last_inbound_at > coalesce(m.sent_at, it.processado_em))
             order by it.posicao)
        from public.envios_em_massa_itens it
        join public.organizations o on o.id = it.organization_id
        left join public.messages m on m.id = it.message_id
        left join public.conversations c on c.id = m.conversation_id
       where it.envio_id = p_id), '[]'::jsonb));
end $$;

-- O teto de primeiros contatos de hoje, para a tela estimar quanto o lote leva.
create or replace function public.envio_em_massa_teto()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_dia date := (now() at time zone 'America/Fortaleza')::date;
begin
  if auth.uid() is null or not app.is_manager() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  return jsonb_build_object(
    'ok', true,
    'teto', app.teto_do_canal('whatsapp'::app.channel, v_dia),
    'usados', app.primeiros_contatos_do_dia('whatsapp'::app.channel, v_dia, app.wa_numero_padrao()));
end $$;

-- ---------------------------------------------------------------------
-- 6. O relógio
-- ---------------------------------------------------------------------
-- Motivos que significam "agora não" (o item espera) e não "nunca" (o item
-- é pulado). Vêm de `app.pode_enviar`.
create or replace function app.envio_motivo_de_espera(p_motivo text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_motivo like 'janela\_%' escape '\'
      or p_motivo in ('teto_do_numero', 'teto_iniciadas_dia', 'teto_iniciadas_hora')
$$;

create or replace function app.envio_um(p_envio public.envios_em_massa, p_item public.envios_em_massa_itens)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_papel  text;
  v_mont   jsonb;
  v_ret    jsonb;
  v_numero text := app.wa_numero_padrao();
  v_tel    text;
  v_ct     uuid;
  v_conv   uuid;
  v_msg    uuid;
begin
  select p.role::text into v_papel from public.profiles p
   where p.id = p_item.assinante_id and p.is_active;
  if v_papel is null or v_papel not in ('admin', 'gestor', 'sdr', 'embaixador') then
    return jsonb_build_object('ok', false, 'motivo', 'assinante_sem_permissao');
  end if;

  select d.telefone, d.contact_id into v_tel, v_ct from app.wa_destino_da_ficha(p_item.organization_id) d;
  if v_tel is null then
    return jsonb_build_object('ok', false, 'motivo', 'ficha_sem_whatsapp');
  end if;
  select c.id into v_conv from public.conversations c
   where c.channel = 'whatsapp'::app.channel and c.business_number = v_numero
     and c.peer_phone_e164 = v_tel;

  -- A cortesia: mensagem nossa sem resposta nas últimas 72 h → fica de fora.
  if v_conv is not null and exists (
       select 1 from public.messages m join public.conversations c on c.id = m.conversation_id
        where m.conversation_id = v_conv and m.direction = 'out'::app.msg_direction
          and m.status <> 'failed'::app.msg_status
          and coalesce(m.sent_at, m.created_at) > now() - interval '72 hours'
          and (c.last_inbound_at is null or coalesce(m.sent_at, m.created_at) > c.last_inbound_at)) then
    return jsonb_build_object('ok', false, 'motivo', 'mensagem_recente_sem_resposta');
  end if;

  v_mont := app.envio_montar(p_envio.tipo, p_envio.modelo_id, p_envio.texto, p_envio.variaveis,
                             p_item.organization_id, p_item.assinante_id);
  if not (v_mont ->> 'ok')::boolean then
    return v_mont;
  end if;

  -- O crachá: daqui até o fim desta transação, quem envia é o assinante.
  perform set_config('request.jwt.claims',
                     jsonb_build_object('sub', p_item.assinante_id, 'role', 'authenticated',
                                        'app_metadata', jsonb_build_object('app_role', v_papel))::text,
                     true);

  if p_envio.tipo = 'modelo' then
    v_ret := public.wa_enviar_modelo(p_item.organization_id, p_envio.modelo_id, v_mont -> 'parametros');
    v_msg := (v_ret ->> 'message_id')::uuid;
  else
    -- Texto livre só existe dentro da janela de 24 h: fora dela a Meta recusa.
    if v_conv is null or not app.janela_de_24h_aberta(v_conv, now()) then
      return jsonb_build_object('ok', false, 'motivo', 'sem_janela_24h');
    end if;
    insert into public.messages (conversation_id, direction, type, status, body,
                                 author_kind, sent_by, origin)
    values (v_conv, 'out'::app.msg_direction, 'text'::app.msg_type, 'queued'::app.msg_status,
            v_mont ->> 'corpo', 'human', p_item.assinante_id, 'crm')
    returning id into v_msg;
  end if;
  return jsonb_build_object('ok', true, 'message_id', v_msg);
end $$;

create or replace function app.envios_em_massa_rodar()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  e        public.envios_em_massa%rowtype;
  it       public.envios_em_massa_itens%rowtype;
  v_ret    jsonb;
  v_motivo text;
  v_passo  interval;
  v_env    int;
  v_sai    int;
  v_quando timestamptz;
  v_tent   int;
  v_feitos int := 0;
  v_dia    date := (now() at time zone 'America/Fortaleza')::date;
begin
  for e in
    select * from public.envios_em_massa
     where status in ('agendado', 'enviando') and proximo_em <= now()
     order by proximo_em
     for update skip locked
  loop
    -- A parada automática (RF-CON-10): 3 ou mais saídas E acima de 2% do
    -- enviado desde `contar_desde`.
    select count(*),
           count(*) filter (where m.error_code = '131050'
                              or app.wa_motivo_de_recusa(x.organization_id, m.contact_id,
                                                         c.peer_phone_e164) is not null)
      into v_env, v_sai
      from public.envios_em_massa_itens x
      join public.messages m on m.id = x.message_id
      join public.conversations c on c.id = m.conversation_id
     where x.envio_id = e.id and x.status = 'enviada' and x.processado_em >= e.contar_desde;
    if v_sai >= 3 and v_sai > 0.02 * greatest(v_env, 1) then
      update public.envios_em_massa
         set status = 'parado', atualizado_em = now(),
             motivo_parada = format('%s de %s pessoas pediram para sair ou bloquearam. Revise a mensagem antes de retomar.',
                                    v_sai, v_env)
       where id = e.id;
      continue;
    end if;

    v_passo := make_interval(secs => 3600.0 / e.por_hora);
    v_tent := 0;
    loop
      v_tent := v_tent + 1;
      exit when v_tent > 20;   -- no máximo 20 pulos por volta; o resto na próxima

      select * into it from public.envios_em_massa_itens
       where envio_id = e.id and status = 'pendente'
       order by posicao limit 1
       for update skip locked;
      if not found then
        update public.envios_em_massa
           set status = 'concluido', concluido_em = now(), atualizado_em = now()
         where id = e.id;
        exit;
      end if;

      begin
        v_ret := app.envio_um(e, it);
      exception when others then
        v_ret := jsonb_build_object('ok', false,
                   'motivo', coalesce(substring(sqlerrm from 'Envio recusado: ([a-z0-9_]+)'), 'erro'),
                   'detalhe', left(sqlerrm, 300));
      end;
      -- O crachá é devolvido antes de qualquer outra coisa.
      perform set_config('request.jwt.claims', '', true);

      if (v_ret ->> 'ok')::boolean then
        update public.envios_em_massa_itens
           set status = 'enviada', message_id = (v_ret ->> 'message_id')::uuid, processado_em = now()
         where id = it.id;
        update public.envios_em_massa
           set status = 'enviando', atualizado_em = now(),
               proximo_em = now() + v_passo * (0.7 + random() * 0.6)
         where id = e.id;
        v_feitos := v_feitos + 1;
        exit;
      end if;

      v_motivo := v_ret ->> 'motivo';
      if app.envio_motivo_de_espera(v_motivo) then
        v_quando := case
          when v_motivo = 'teto_iniciadas_hora' then now() + interval '15 minutes'
          when v_motivo like 'janela\_%' escape '\' then
            (app.janela_do_canal('whatsapp'::app.channel, now(), false) ->> 'abre_em')::timestamptz
          else app.proxima_abertura_do_canal(v_dia, 'whatsapp'::app.channel, false)
        end;
        update public.envios_em_massa
           set status = 'enviando', atualizado_em = now(),
               proximo_em = coalesce(v_quando, now() + interval '30 minutes')
                            + make_interval(secs => random() * 600)
         where id = e.id;
        exit;
      end if;

      if v_motivo = 'modelo_nao_aprovado_na_meta' then
        update public.envios_em_massa
           set status = 'parado', atualizado_em = now(),
               motivo_parada = 'A Meta não aceita mais este modelo (pausado ou recusado). Escolha outro e crie um envio novo.'
         where id = e.id;
        exit;
      end if;

      update public.envios_em_massa_itens
         set status = 'pulada', motivo = v_motivo, processado_em = now()
       where id = it.id;
    end loop;
  end loop;
  return v_feitos;
end $$;

-- ---------------------------------------------------------------------
-- 7. Permissões e relógio
-- ---------------------------------------------------------------------
revoke all on function app.envio_publico(jsonb) from public, anon, authenticated;
revoke all on function app.envio_campos_da_ficha(uuid) from public, anon, authenticated;
revoke all on function app.envio_montar(text, int, text, jsonb, uuid, uuid) from public, anon, authenticated;
revoke all on function app.envio_assinante(text, uuid[], int, uuid, uuid) from public, anon, authenticated;
revoke all on function app.envio_contagem(uuid) from public, anon, authenticated;
revoke all on function app.envio_motivo_de_espera(text) from public, anon, authenticated;
revoke all on function app.envio_um(public.envios_em_massa, public.envios_em_massa_itens) from public, anon, authenticated;
revoke all on function app.envios_em_massa_rodar() from public, anon, authenticated;

revoke all on function public.envio_em_massa_publico(jsonb) from public, anon;
revoke all on function public.envio_em_massa_previa(jsonb, uuid[]) from public, anon;
revoke all on function public.envio_em_massa_criar(jsonb) from public, anon;
revoke all on function public.envio_em_massa_mudar(uuid, text) from public, anon;
revoke all on function public.envios_em_massa_lista() from public, anon;
revoke all on function public.envio_em_massa_detalhe(uuid) from public, anon;
revoke all on function public.envio_em_massa_teto() from public, anon;
grant execute on function public.envio_em_massa_teto() to authenticated;
grant execute on function public.envio_em_massa_publico(jsonb) to authenticated;
grant execute on function public.envio_em_massa_previa(jsonb, uuid[]) to authenticated;
grant execute on function public.envio_em_massa_criar(jsonb) to authenticated;
grant execute on function public.envio_em_massa_mudar(uuid, text) to authenticated;
grant execute on function public.envios_em_massa_lista() to authenticated;
grant execute on function public.envio_em_massa_detalhe(uuid) to authenticated;

select cron.schedule('envios_em_massa', '* * * * *', 'select app.envios_em_massa_rodar()');

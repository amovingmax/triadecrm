-- =====================================================================
-- O envio em massa fala em nome da Komune, pede UMA ação e mede o resultado
--
-- Decisão do Rafael em 21/09/2026: "esse envio em massa, eu n quero com
-- assinatura de quem mandou pela equipe, será mais voltado a ações que
-- queremos que os leads façam". O modelo é o das empresas de disparo pela API
-- oficial: mensagem da marca, botão em vez de "me responde", passo seguinte
-- automático e conversão medida.
--
-- O QUE ENTRA
--   1. BOTÕES nos modelos (`message_templates.botoes`): até 3, no máximo 1 de
--      link. O de resposta rápida volta como mensagem com o texto do botão; o
--      de link aponta sempre para o NOSSO endereço (`/r/<código>`), que conta o
--      clique e manda para o destino escolhido no envio.
--   2. MODELO NOVO pela tela (`public.modelo_whatsapp_criar`): nasce sem status
--      na Meta, e a sincronização do worker (de 30 em 30 min) o manda para
--      aprovação.
--   3. ASSINATURA "marca": o envio sai sem nome de atendente. Modelo com
--      {{atendente}} não entra num envio da marca; texto livre sai sem o
--      "*Fulano:*" que `app.messages_nome_do_atendente` põe na frente.
--   4. A RESPOSTA AO BOTÃO: quem toca num botão de resposta recebe, na hora, o
--      que o envio mandou fazer — um link (grátis: a pessoa acabou de abrir a
--      janela de 24 h), o fim do contato, ou nada (a conversa já cai na caixa).
--   5. O CLIQUE E O CADASTRO por envio: cada item tem um código; o clique é
--      gravado em `/r/<código>`, e "cadastrou" é quem não estava na Komune
--      quando o envio foi criado e passou a estar.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Botões nos modelos
-- ---------------------------------------------------------------------
alter table public.message_templates
  add column if not exists botoes jsonb not null default '[]'::jsonb;

create or replace function app.modelo_botoes_validos(p_botoes jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p_botoes) = 'array'
     and jsonb_array_length(p_botoes) <= 3
     and (select count(*) from jsonb_array_elements(p_botoes) b where b ->> 'tipo' = 'link') <= 1
     and not exists (
           select 1 from jsonb_array_elements(p_botoes) b
            where coalesce(b ->> 'tipo', '') not in ('resposta', 'link')
               or length(btrim(coalesce(b ->> 'texto', ''))) not between 1 and 25)
     -- Dois botões com o mesmo texto: a resposta não diria qual foi tocado.
     and (select count(distinct lower(btrim(b ->> 'texto'))) from jsonb_array_elements(p_botoes) b)
         = jsonb_array_length(p_botoes)
$$;

alter table public.message_templates
  add constraint message_templates_botoes_validos check (app.modelo_botoes_validos(botoes));

comment on column public.message_templates.botoes is
  'Botões do modelo na Meta: [{"tipo":"resposta"|"link","texto":"até 25 letras"}]. O link aponta sempre para envios.link.base || <código do item>.';

insert into public.app_settings (key, value, description) values
  ('envios.link', jsonb_build_object(
     'base', 'https://triade-crm-tawny.vercel.app/r/',
     'destino_padrao', 'https://admin.komune.app.br/seja-parceiro'),
   'Link rastreado dos envios em massa: o botão de link aponta para base || código; o destino padrão é para onde vai quem clica num link sem envio.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 2. Modelo novo pela tela
-- ---------------------------------------------------------------------
-- O mesmo que a Meta recusaria de certeza (modelos-meta.ts, validarModelo),
-- dito antes de gravar: variável no começo, no fim, ou colada em outra.
create or replace function app.modelo_corpo_invalido(p_corpo text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := btrim(coalesce(p_corpo, ''));
  r text[];
begin
  if v = '' then return 'corpo_vazio'; end if;
  if length(v) > 1024 then return 'corpo_longo_demais'; end if;
  for r in select regexp_matches(v, '\{\{([^{}]*)\}\}', 'g') loop
    if btrim(r[1]) !~ '^[a-z][a-z0-9_]*$' then return 'variavel_fora_do_formato'; end if;
  end loop;
  if v ~ '^[[:space:].!?,;:¡¿-]*\{\{' or v ~ '\}\}[[:space:].!?,;:-]*$' then
    return 'variavel_na_borda';
  end if;
  if v ~ '\}\}\s*\{\{' then return 'variaveis_coladas'; end if;
  return null;
end $$;

create or replace function public.modelo_whatsapp_criar(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nome   text := btrim(coalesce(p ->> 'nome', ''));
  v_cat    text := coalesce(p ->> 'categoria', 'marketing');
  v_corpo  text := btrim(coalesce(p ->> 'corpo', ''));
  v_botoes jsonb := coalesce(p -> 'botoes', '[]'::jsonb);
  v_erro   text;
  v_codigo text;
  v_id     int;
begin
  if auth.uid() is null or not app.is_manager() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if length(v_nome) not between 3 and 80 then
    return jsonb_build_object('ok', false, 'motivo', 'nome_invalido');
  end if;
  if v_cat not in ('marketing', 'utility') then
    return jsonb_build_object('ok', false, 'motivo', 'categoria_invalida');
  end if;
  v_erro := app.modelo_corpo_invalido(v_corpo);
  if v_erro is not null then
    return jsonb_build_object('ok', false, 'motivo', v_erro);
  end if;
  if not app.modelo_botoes_validos(v_botoes) then
    return jsonb_build_object('ok', false, 'motivo', 'botoes_invalidos');
  end if;

  -- Código legível e único: ENV-<nome>-<4 letras>.
  v_codigo := 'ENV-' || left(upper(regexp_replace(app.search_name(v_nome), '[^a-z0-9]+', '-', 'g')), 40)
              || '-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 4));
  v_codigo := regexp_replace(v_codigo, '-+', '-', 'g');

  insert into public.message_templates (template_code, name, channel, category, segment, kind,
                                        language, body, botoes, is_active, version)
  values (v_codigo, v_nome, 'whatsapp'::app.channel, v_cat, 'GEN', 'envio',
          'pt_BR', v_corpo,
          (select coalesce(jsonb_agg(jsonb_build_object('tipo', b ->> 'tipo',
                                                        'texto', btrim(b ->> 'texto'))), '[]'::jsonb)
             from jsonb_array_elements(v_botoes) b),
          true, 1)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'codigo', v_codigo);
end $$;

-- ---------------------------------------------------------------------
-- 3. Os modelos que vão para a Meta levam os botões e a base do link
-- ---------------------------------------------------------------------
create or replace function public.wa_modelos_para_meta()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'template_id',     t.id,
           'codigo',          t.template_code,
           'nome_meta_atual', t.meta_template_name,
           'situacao_atual',  t.meta_status,
           'nome_sugerido',   lower(regexp_replace(t.template_code, '[^A-Za-z0-9]+', '_', 'g'))
                                || '_v' || t.version,
           'categoria',       upper(case when t.template_code = 'GEN-SYS-OPTOUT' then 'utility'
                                         else t.category end),
           'idioma',          t.language,
           'corpo',           x.corpo,
           'variaveis',       to_jsonb(app.modelo_variaveis(x.corpo)),
           'botoes',          t.botoes,
           'link_base',       (select s.value ->> 'base' from public.app_settings s where s.key = 'envios.link'))
         order by t.template_code), '[]'::jsonb)
    from public.message_templates t
    cross join lateral (
      select regexp_replace(
               case when t.template_code = 'GEN-SYS-OPTOUT' then app.corpo_fixo_de_optout(t.body)
                    else t.body end,
               '\{\{\s*([a-z][a-z0-9_]*)\s*\}\}', '{{\1}}', 'g') as corpo
    ) x
   where t.is_active
     and t.channel = 'whatsapp'::app.channel
     and (t.category in ('marketing', 'utility') or t.template_code = 'GEN-SYS-OPTOUT')
     and x.corpo is not null
$$;

-- ---------------------------------------------------------------------
-- 4. O envio: assinatura da marca, destino do link, ações dos botões
-- ---------------------------------------------------------------------
alter table public.envios_em_massa
  drop constraint if exists envios_em_massa_assinatura_check;
alter table public.envios_em_massa
  add constraint envios_em_massa_assinatura_check
  check (assinatura in ('eu', 'responsavel', 'revezar', 'marca'));
alter table public.envios_em_massa
  add column if not exists link_destino text
    check (link_destino is null or link_destino ~ '^https://[^\s]+$'),
  -- {"quero o convite": {"acao":"link","texto":"…","botao":"Criar meu perfil"},
  --  "agora não": {"acao":"sair"}}   — chave é o texto do botão, minúsculo.
  add column if not exists acoes jsonb not null default '{}'::jsonb;

alter table public.envios_em_massa_itens
  add column if not exists codigo text unique
    default substr(md5(random()::text || clock_timestamp()::text), 1, 12),
  add column if not exists ja_na_komune boolean not null default false,
  add column if not exists clicou_em timestamptz,
  add column if not exists botao_tocado text,
  add column if not exists botao_em timestamptz;
update public.envios_em_massa_itens set codigo = substr(md5(random()::text || id::text), 1, 12)
 where codigo is null;
alter table public.envios_em_massa_itens alter column codigo set not null;

create or replace function app.org_na_komune(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.organizations o where o.id = p_org and o.komune_supplier_id is not null)
      or exists (select 1 from public.pre_registrations pr
                  where pr.organization_id = p_org and (pr.claimed_at is not null or pr.published))
$$;

-- O assinante da marca é quem montou o envio: é quem responde pelo que saiu
-- (ADR-05), mesmo que o nome não apareça para o parceiro.
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
    when 'marca' then p_quem_cria
    when 'responsavel' then coalesce(
      (select p.id from public.profiles p where p.id = p_dono and p.is_active), p_quem_cria)
    else p_atendentes[1 + (p_posicao % cardinality(p_atendentes))]
  end
$$;

-- As ações dos botões de resposta, normalizadas: chave em minúsculas, só as
-- três ações que existem, link com texto e rótulo.
create or replace function app.envio_acoes_validas(p_acoes jsonb, p_botoes jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(coalesce(p_acoes, '{}'::jsonb)) = 'object'
     and not exists (
       select 1 from jsonb_each(coalesce(p_acoes, '{}'::jsonb)) a
        where a.value ->> 'acao' not in ('link', 'sair', 'nada')
           or (a.value ->> 'acao' = 'link'
               and (length(btrim(coalesce(a.value ->> 'texto', ''))) not between 1 and 900
                    or length(btrim(coalesce(a.value ->> 'botao', ''))) not between 1 and 20))
           or not exists (select 1 from jsonb_array_elements(coalesce(p_botoes, '[]'::jsonb)) b
                           where b ->> 'tipo' = 'resposta'
                             and lower(btrim(b ->> 'texto')) = a.key))
$$;

-- `envio_em_massa_criar` ganha marca, destino e ações. Recriada inteira a partir
-- da 20260921100000; o que mudou está marcado com "NOVO".
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
  v_modo    text := coalesce(p_config ->> 'assinatura', 'marca');
  v_atds    uuid[] := array(select distinct x::uuid
                              from jsonb_array_elements_text(coalesce(p_config -> 'atendentes', '[]')) x);
  v_orgs    uuid[] := array(select x.v::uuid
                              from jsonb_array_elements_text(coalesce(p_config -> 'organizacoes', '[]'))
                                   with ordinality x(v, n)
                             group by x.v order by min(x.n));
  v_hora    int  := coalesce(nullif(p_config ->> 'por_hora', '')::int, 20);
  v_inicio  timestamptz := coalesce(nullif(p_config ->> 'inicio', '')::timestamptz, now());
  v_nome    text := btrim(coalesce(p_config ->> 'nome', ''));
  -- NOVO
  v_destino text := nullif(btrim(coalesce(p_config ->> 'link_destino', '')), '');
  v_acoes   jsonb := coalesce(p_config -> 'acoes', '{}'::jsonb);
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

  -- NOVO: em nome da marca, ninguém assina — nem dentro do texto.
  if v_modo = 'marca' and 'atendente' = any (app.modelo_variaveis(coalesce(t.body, v_texto))) then
    return jsonb_build_object('ok', false, 'motivo', 'modelo_tem_atendente');
  end if;

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

  -- NOVO: destino do link e ações dos botões.
  if v_destino is not null and v_destino !~ '^https://[^\s]+$' then
    return jsonb_build_object('ok', false, 'motivo', 'destino_invalido');
  end if;
  v_acoes := coalesce((select jsonb_object_agg(lower(btrim(a.key)), a.value)
                         from jsonb_each(v_acoes) a), '{}'::jsonb);
  if not app.envio_acoes_validas(v_acoes, coalesce(t.botoes, '[]'::jsonb)) then
    return jsonb_build_object('ok', false, 'motivo', 'acoes_invalidas');
  end if;

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
  if v_modo not in ('eu', 'responsavel', 'revezar', 'marca') then
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
                                      atendentes, por_hora, inicio, proximo_em, criado_por,
                                      link_destino, acoes)
  values (v_nome, v_tipo, v_modelo, v_texto, v_vars, coalesce(p_config -> 'filtro', '{}'),
          v_modo, v_atds, v_hora, v_inicio, greatest(v_inicio, now()), v_eu,
          v_destino, v_acoes)
  returning id into v_id;

  foreach v_org in array v_orgs loop
    continue when not exists (select 1 from public.organizations o
                               where o.id = v_org and o.deleted_at is null and app.org_is_visible(o.id));
    insert into public.envios_em_massa_itens (envio_id, posicao, organization_id, assinante_id, ja_na_komune)
    values (v_id, v_i, v_org,
            app.envio_assinante(v_modo, v_atds, v_i,
                                (select o.owner_id from public.organizations o where o.id = v_org), v_eu),
            app.org_na_komune(v_org));
    v_i := v_i + 1;
  end loop;

  if v_i = 0 then
    delete from public.envios_em_massa where id = v_id;
    return jsonb_build_object('ok', false, 'motivo', 'publico_vazio');
  end if;
  return jsonb_build_object('ok', true, 'id', v_id, 'itens', v_i);
end $$;

-- ---------------------------------------------------------------------
-- 5. Em nome da marca, o texto livre sai sem "*Fulano:*"
-- ---------------------------------------------------------------------
-- A voz é um ajuste LOCAL da transação (`app.voz`), ligado por quem manda em
-- nome da marca — o relógio do envio e a resposta ao botão — e por mais
-- ninguém. Fora desses dois caminhos ele não existe, e a regra de sempre vale.
create or replace function app.messages_nome_do_atendente()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nome  text;
  v_linha text;
begin
  if new.direction <> 'out'::app.msg_direction
     or new.origin <> 'crm'
     or new.type <> 'text'::app.msg_type
     or new.template_id is not null
     or new.optout_confirmation
     or new.author_kind not in ('human', 'bot_ai')
     or nullif(btrim(coalesce(new.body, '')), '') is null
     or coalesce(current_setting('app.voz', true), '') = 'marca'
     or not coalesce((select (s.value ->> 'assinar_com_nome')::boolean
                        from public.app_settings s where s.key = 'whatsapp.envio'), true) then
    return new;
  end if;

  v_nome := app.primeiro_nome(case when new.author_kind = 'bot_ai' then new.approved_by
                                   else new.sent_by end);
  if v_nome is null then
    return new;
  end if;

  v_linha := '*' || v_nome || ':*';
  if left(new.body, length(v_linha)) is distinct from v_linha then
    new.body := v_linha || E'\n' || new.body;
  end if;
  return new;
end $$;

-- O relógio liga a voz da marca antes de cada envio de um lote "marca".
-- Recriada a partir da 20260921100000; o que mudou está marcado com "NOVO".
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

  perform set_config('request.jwt.claims',
                     jsonb_build_object('sub', p_item.assinante_id, 'role', 'authenticated',
                                        'app_metadata', jsonb_build_object('app_role', v_papel))::text,
                     true);
  -- NOVO: a voz da marca vale até o fim desta volta do relógio.
  perform set_config('app.voz', case when p_envio.assinatura = 'marca' then 'marca' else '' end, true);

  if p_envio.tipo = 'modelo' then
    v_ret := public.wa_enviar_modelo(p_item.organization_id, p_envio.modelo_id, v_mont -> 'parametros');
    v_msg := (v_ret ->> 'message_id')::uuid;
  else
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

-- O relógio devolve a voz junto com o crachá. Só a linha do "devolver" mudou.
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
      exit when v_tent > 20;

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
      perform set_config('request.jwt.claims', '', true);
      perform set_config('app.voz', '', true);

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
-- 6. A resposta ao botão
-- ---------------------------------------------------------------------
-- A resposta rápida de um modelo volta como mensagem comum com o TEXTO do
-- botão (supabase/functions/wa-webhook/extrair.ts). Quem casa o texto com o
-- botão é o envio mais recente desta conversa, dos últimos 7 dias.
create or replace function app.envio_resposta_ao_botao(p_message_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  m       public.messages%rowtype;
  it      public.envios_em_massa_itens%rowtype;
  e       public.envios_em_massa%rowtype;
  v_chave text;
  v_acao  jsonb;
  v_base  text := (select s.value ->> 'base' from public.app_settings s where s.key = 'envios.link');
  v_msg   uuid;
begin
  select * into m from public.messages where id = p_message_id;
  if not found or m.direction <> 'in'::app.msg_direction then
    return jsonb_build_object('agiu', false, 'motivo', 'nao_e_entrada');
  end if;
  v_chave := lower(btrim(coalesce(m.body, '')));
  if v_chave = '' or length(v_chave) > 25 then
    return jsonb_build_object('agiu', false, 'motivo', 'nao_e_botao');
  end if;

  select x.* into it
    from public.envios_em_massa_itens x
    join public.messages o on o.id = x.message_id
   where o.conversation_id = m.conversation_id
     and x.status = 'enviada'
     and x.processado_em > now() - interval '7 days'
   order by x.processado_em desc
   limit 1;
  if not found then
    return jsonb_build_object('agiu', false, 'motivo', 'sem_envio_recente');
  end if;
  select * into e from public.envios_em_massa where id = it.envio_id;
  v_acao := e.acoes -> v_chave;
  if v_acao is null then
    return jsonb_build_object('agiu', false, 'motivo', 'texto_nao_e_botao_do_envio');
  end if;
  -- Um toque vale uma vez: tocar de novo não manda o link de novo.
  if it.botao_tocado is not null then
    return jsonb_build_object('agiu', false, 'motivo', 'botao_ja_tocado');
  end if;

  update public.envios_em_massa_itens
     set botao_tocado = v_chave, botao_em = now()
   where id = it.id;

  if v_acao ->> 'acao' = 'sair' then
    perform public.wa_optout_registrar(m.conversation_id,
      format('Tocou em "%s" no envio em massa "%s".', m.body, e.nome), true);
    return jsonb_build_object('agiu', true, 'o_que', 'sair');
  end if;

  if v_acao ->> 'acao' = 'link' then
    perform set_config('app.voz', case when e.assinatura = 'marca' then 'marca' else '' end, true);
    insert into public.messages (conversation_id, direction, type, status, body, template_params,
                                 author_kind, sent_by, origin)
    values (m.conversation_id, 'out'::app.msg_direction, 'interactive'::app.msg_type,
            'queued'::app.msg_status, btrim(v_acao ->> 'texto'),
            jsonb_build_object('botao', btrim(v_acao ->> 'botao'), 'url', v_base || it.codigo),
            'human', e.criado_por, 'crm')
    returning id into v_msg;
    perform set_config('app.voz', '', true);
    return jsonb_build_object('agiu', true, 'o_que', 'link', 'message_id', v_msg);
  end if;

  return jsonb_build_object('agiu', true, 'o_que', 'nada');
end $$;

create or replace function app.messages_resposta_ao_botao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform app.envio_resposta_ao_botao(new.id);
  exception when others then
    -- A mensagem que chegou vale mais que a resposta automática dela.
    raise warning 'envio_resposta_ao_botao(%): %', new.id, sqlerrm;
  end;
  return null;
end $$;

create trigger messages_resposta_ao_botao
  after insert on public.messages
  for each row when (new.direction = 'in'::app.msg_direction)
  execute function app.messages_resposta_ao_botao();

-- ---------------------------------------------------------------------
-- 7. O clique
-- ---------------------------------------------------------------------
-- Chamado pela rota pública `/r/<código>`, sem sessão: é o parceiro clicando.
-- Grava o PRIMEIRO clique e devolve o destino — que vem do banco, nunca da
-- URL (quem clica não escolhe para onde vai). Código desconhecido vai para o
-- destino padrão, e não para uma página de erro.
create or replace function public.envio_clique(p_codigo text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cfg     jsonb := (select s.value from public.app_settings s where s.key = 'envios.link');
  v_padrao  text := coalesce(v_cfg ->> 'destino_padrao', 'https://admin.komune.app.br/seja-parceiro');
  it        public.envios_em_massa_itens%rowtype;
  e         public.envios_em_massa%rowtype;
  v_destino text;
  v_slug    text;
begin
  if p_codigo is null or p_codigo !~ '^[a-f0-9]{12}$' then
    return v_padrao;
  end if;
  select * into it from public.envios_em_massa_itens where codigo = p_codigo;
  if not found then
    return v_padrao;
  end if;
  update public.envios_em_massa_itens set clicou_em = now()
   where id = it.id and clicou_em is null;
  select * into e from public.envios_em_massa where id = it.envio_id;
  v_destino := coalesce(e.link_destino, v_padrao);
  v_slug := left(regexp_replace(app.search_name(e.nome), '[^a-z0-9]+', '-', 'g'), 60);
  return v_destino || case when position('?' in v_destino) > 0 then '&' else '?' end
         || 'utm_source=whatsapp&utm_medium=envio_em_massa&utm_campaign=' || v_slug
         || '&utm_content=' || it.codigo;
end $$;

-- ---------------------------------------------------------------------
-- 8. A saída leva os botões e o código; a contagem ganha clique e cadastro
-- ---------------------------------------------------------------------
create or replace function public.wa_saida_proximos(p_qty integer default 10)
returns jsonb
language plpgsql
set search_path to ''
as $$
declare
  v_bruto     jsonb;
  v_item      jsonb;
  v_out       jsonb := '[]'::jsonb;
  v_recusados jsonb;
  v_modelo    jsonb;
  v_precisa   boolean;
  v_mid       uuid;
  v_msgid     bigint;
  v_conv      uuid;
begin
  v_bruto     := app.wa_proximos(p_qty);
  v_recusados := coalesce(v_bruto -> 'recusados', '[]'::jsonb);

  for v_item in select * from jsonb_array_elements(v_recusados) loop
    if (v_item ->> 'acao') = 'adiado' and (v_item ->> 'message_id') is not null then
      update public.messages
         set error_detail = left(app.wa_motivo_legivel(v_item ->> 'motivo',
                                                       (v_item ->> 'quando')::timestamptz), 2000)
       where id = (v_item ->> 'message_id')::uuid
         and status = 'queued'::app.msg_status;
    end if;
  end loop;

  for v_item in select * from jsonb_array_elements(coalesce(v_bruto -> 'itens', '[]'::jsonb)) loop
    v_mid   := (v_item ->> 'message_id')::uuid;
    v_conv  := (v_item ->> 'conversation_id')::uuid;
    v_msgid := (v_item ->> 'msg_id')::bigint;

    v_precisa := not app.janela_de_24h_aberta(v_conv, now());

    v_modelo := app.wa_modelo_da_meta((v_item ->> 'template_id')::int);

    if v_precisa and not coalesce((v_modelo ->> 'aprovado')::boolean, false) then
      update public.messages
         set status = 'failed'::app.msg_status,
             error_code = 'sem_modelo_aprovado',
             error_detail = case
               when (v_modelo ->> 'situacao') = 'sem_modelo' then
                 'Fora da janela de 24 h e sem modelo: a Meta só aceita template aprovado para iniciar conversa.'
               else
                 'Fora da janela de 24 h e o modelo ' || coalesce(v_modelo ->> 'codigo', '(sem código)') ||
                 ' ainda não está aprovado pela Meta (situação: ' ||
                 (v_modelo ->> 'situacao') || ').'
               end,
             failed_at = now()
       where id = v_mid and status = 'queued'::app.msg_status;
      update public.message_drafts
         set status = 'descartado',
             discard_reason = 'recusado na entrega: sem modelo aprovado pela Meta'
       where message_id = v_mid and status in ('aprovado', 'enviado');
      perform pgmq.archive('wa_outbound', v_msgid);
      v_recusados := v_recusados || jsonb_build_array(
        jsonb_build_object('message_id', v_mid, 'motivo', 'sem_modelo_aprovado', 'acao', 'morto'));
      continue;
    end if;

    v_out := v_out || jsonb_build_array(v_item || jsonb_build_object(
      'janela_aberta', not v_precisa,
      'modelo', case when coalesce((v_modelo ->> 'aprovado')::boolean, false)
                     then v_modelo - 'aprovado' - 'situacao' else null end,
      -- NOVO: os botões do modelo e o código do item do envio (o sufixo do
      -- botão de link). Mensagem fora de envio usa "crm" — o clique cai no
      -- destino padrão.
      'botoes', coalesce((select t.botoes from public.message_templates t
                           where t.id = (v_item ->> 'template_id')::int), '[]'::jsonb),
      'link_codigo', coalesce((select x.codigo from public.envios_em_massa_itens x
                                where x.message_id = v_mid), 'crm')));
  end loop;

  return jsonb_build_object('itens', v_out, 'recusados', v_recusados);
end $$;

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
                     or app.wa_motivo_de_recusa(organization_id, contact_id, peer_phone_e164) is not null)),
    -- NOVO
    'tocaram',    count(*) filter (where botao_tocado is not null),
    'clicaram',   count(*) filter (where clicou_em is not null),
    'cadastraram', count(*) filter (where status = 'enviada' and not ja_na_komune
                                      and app.org_na_komune(organization_id)))
    from i
$$;

-- O detalhe ganha, por item, o botão tocado, o clique e o cadastro.
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
                            and c.last_inbound_at > coalesce(m.sent_at, it.processado_em),
               'botao_tocado', it.botao_tocado,
               'clicou', it.clicou_em is not null,
               'cadastrou', it.status = 'enviada' and not it.ja_na_komune
                            and app.org_na_komune(it.organization_id))
             order by it.posicao)
        from public.envios_em_massa_itens it
        join public.organizations o on o.id = it.organization_id
        left join public.messages m on m.id = it.message_id
        left join public.conversations c on c.id = m.conversation_id
       where it.envio_id = p_id), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------
-- 9. Os três modelos da marca, com botões
-- ---------------------------------------------------------------------
-- Sem {{atendente}}, sem link no corpo, uma ação por mensagem. O primeiro é
-- para quem nunca falou com a gente: botão de RESPOSTA, não de link — link
-- vindo de número desconhecido parece golpe e é o que mais gera bloqueio.
insert into public.message_templates (template_code, name, channel, category, segment, kind,
                                      language, body, botoes, is_active, version)
values
  ('ENV-CONVITE-FUNDADOR', 'Convite de fornecedor fundador (Komune)', 'whatsapp', 'marketing', 'GEN', 'envio', 'pt_BR',
   'Oi, {{nome}}. Aqui é a Komune, o app de eventos de Natal. Estamos montando a lista de fornecedores fundadores de {{categoria}}: perfil grátis, sem mensalidade, e você só paga quando fechar um evento pelo app. Quer receber o convite?',
   '[{"tipo":"resposta","texto":"Quero o convite"},{"tipo":"resposta","texto":"Agora não"}]', true, 1),
  ('ENV-CADASTRO-PENDENTE', 'Convite ainda vale — criar perfil (Komune)', 'whatsapp', 'marketing', 'GEN', 'envio', 'pt_BR',
   'Oi, {{nome}}. Seu convite de fornecedor fundador na Komune continua valendo. O cadastro leva 5 minutos e é grátis.',
   '[{"tipo":"link","texto":"Criar meu perfil"}]', true, 1),
  ('ENV-COMPLETAR-PERFIL', 'Completar o perfil (Komune)', 'whatsapp', 'marketing', 'GEN', 'envio', 'pt_BR',
   'Oi, {{nome}}. Seu perfil na Komune está no ar. Perfis com fotos aparecem primeiro para quem está organizando evento, e falta pouco para o seu ficar completo.',
   '[{"tipo":"link","texto":"Completar meu perfil"}]', true, 1)
on conflict (template_code) do nothing;

-- ---------------------------------------------------------------------
-- 10. Permissões
-- ---------------------------------------------------------------------
-- A regra dos botões é CHECK da tabela: quem grava modelo (gestor, pela RLS)
-- precisa poder executá-la, senão até ligar e desligar modelo quebra.
revoke all on function app.modelo_botoes_validos(jsonb) from public, anon;
grant execute on function app.modelo_botoes_validos(jsonb) to authenticated, service_role;
revoke all on function app.modelo_corpo_invalido(text) from public, anon, authenticated;
revoke all on function app.org_na_komune(uuid) from public, anon, authenticated;
revoke all on function app.envio_acoes_validas(jsonb, jsonb) from public, anon, authenticated;
revoke all on function app.envio_resposta_ao_botao(uuid) from public, anon, authenticated;
revoke all on function app.messages_resposta_ao_botao() from public, anon, authenticated;
revoke all on function public.modelo_whatsapp_criar(jsonb) from public, anon;
grant execute on function public.modelo_whatsapp_criar(jsonb) to authenticated;
revoke all on function public.envio_clique(text) from public;
grant execute on function public.envio_clique(text) to anon, authenticated;
-- A contagem e o detalhe já tinham as permissões da 20260921100000 (create or
-- replace mantém os grants).

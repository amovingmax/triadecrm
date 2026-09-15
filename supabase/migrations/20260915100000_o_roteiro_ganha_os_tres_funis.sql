-- O roteiro de ligação ganha os três funis: fornecedor, produtor/cerimonialista e ativação.
--
-- Base: o script de captação que o Rafael mandou em 15/09/2026 (abertura com permissão,
-- quem somos, motivo, proposta de valor sem mensalidade, fechamento com duas opções de
-- horário, ramificações), adaptado a cada funil. Decisões dele, na mesma conversa:
--
--   * o foco é marcar reunião: a gratuidade de estar na plataforma é dita com ênfase e o
--     percentual do fornecedor NÃO se diz na ligação (a apresentação mostra a conta);
--   * ao produtor e ao cerimonialista se diz o que ele recebe: 5%, depois da entrega;
--   * a ativação liga por três motivos, conforme a etapa do negócio: completar o perfil
--     (publicado, perfil_completo), pedido parado (primeiro_lead, lead_respondido) e
--     reativar (em_risco). Quem já contratou pela Komune não entra em lote.
--
-- O que muda no motor:
--   1. `variante` do nó ganha 'captacao' (fornecedor + produtor) e 'ativacao';
--      `app.validar_roteiro` confere a ativação só em árvore que tem ativação.
--   2. A variante da ligação sai do FUNIL do lote (`pipelines.slug`), não do
--      `organizations.kind`: um fornecedor no funil de ativação ouve o roteiro de
--      ativação. `proximo_da_fila` devolve também o nó de `entrada`.
--   3. `app.call_candidates` tira do lote de ativação quem está em
--      primeira_contratacao ou recorrente (`etapa_sem_ligacao`).
--   4. Roteiro `captacao_v1` versão 3 publicado; a v2 sai de publicação e continua
--      servindo os lotes montados com ela.
--   5. Três modelos de WhatsApp para depois da ligação: confirmação da reunião e o
--      resumo para fornecedor e para produtor.


-- ===========================================================================
-- 1. Onde um nó vale, e a validação que conhece o terceiro caminho
-- ===========================================================================
create or replace function app.no_vale_na_variante(p_escopo text, p_variante text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_escopo = 'ambas'
      or p_escopo = p_variante
      or (p_escopo = 'captacao' and p_variante in ('fornecedor', 'produtor'))
$$;
comment on function app.no_vale_na_variante(text, text) is
  'Um nó do roteiro vale nesta variante? ambas = as três; captacao = fornecedor e produtor. Espelho de noValeNaVariante em components/ligacao/tipos.ts.';
revoke all on function app.no_vale_na_variante(text, text) from public, anon;
grant execute on function app.no_vale_na_variante(text, text) to authenticated, service_role;

create or replace function app.variante_da_ligacao(p_batch_id uuid, p_kind app.org_kind)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
           -- Lote de ativação com roteiro que não tem ativação (a v2): cai na regra antiga.
           when p.slug = 'ativacao'
            and exists (select 1 from jsonb_array_elements(s.arvore) n
                         where n ->> 'variante' = 'ativacao')          then 'ativacao'
           when p.slug = 'produtor'                                     then 'produtor'
           when p.slug = 'fornecedor'                                   then 'fornecedor'
           when p_kind in ('produtor'::app.org_kind, 'cerimonialista'::app.org_kind)
                                                                        then 'produtor'
           else 'fornecedor'
         end
    from public.call_batches b
    join public.pipelines p on p.id = b.pipeline_id
    left join public.call_scripts s on s.id = b.script_id
   where b.id = p_batch_id
$$;
comment on function app.variante_da_ligacao(uuid, app.org_kind) is
  'A variante do roteiro de uma ligação, pelo funil do lote: fornecedor, produtor ou ativacao. Funil sem variante própria (ou ativação com roteiro sem ativação) cai na regra antiga, pelo tipo da organização.';
revoke all on function app.variante_da_ligacao(uuid, app.org_kind) from public, anon, authenticated;

create or replace function app.entrada_da_ligacao(p_variante text, p_stage_id int)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
           when p_variante is distinct from 'ativacao' then 'abertura'
           else case (select s.slug from public.stages s where s.id = p_stage_id)
                  when 'primeiro_lead'   then 'ativ_abertura_pedido'
                  when 'lead_respondido' then 'ativ_abertura_respondido'
                  when 'em_risco'        then 'ativ_abertura_reativar'
                  else 'ativ_abertura_perfil'
                end
         end
$$;
comment on function app.entrada_da_ligacao(text, int) is
  'O nó em que a fala começa. Captação: abertura. Ativação, pela etapa do negócio: primeiro_lead → pedido esperando resposta; lead_respondido → pedido respondido; em_risco → reativar; o resto (publicado, perfil_completo) → completar o perfil.';
revoke all on function app.entrada_da_ligacao(text, int) from public, anon, authenticated;


create or replace function app.validar_roteiro(p_arvore jsonb)
returns text[]
language plpgsql
-- STABLE e não IMMUTABLE: as mensagens saem de `format()`, que é STABLE (depende da
-- função de saída dos tipos). A função não lê tabela nenhuma; declarar IMMUTABLE
-- seria uma promessa maior do que o corpo cumpre — e o `supabase db lint` avisa.
stable
set search_path = ''
as $$
declare
  -- `'{}'::text[]` e `|| ...::text` explícitos: com a literal sem tipo, o Postgres
  -- resolve `text[] || unknown` como `array_cat(anyarray, anyarray)` e estoura
  -- "malformed array literal" em tempo de execução — só no caminho do erro, que é
  -- justamente o que esta função existe para percorrer. Quem apontou foi o db lint.
  v_erros    text[] := '{}'::text[];
  v_no       jsonb;
  v_saida    jsonb;
  v_ids      text[];
  v_variante text;
  v_destino  jsonb;
  v_sobrou   boolean;
  v_variantes text[];
  v_entrada  text;
begin
  if jsonb_typeof(p_arvore) <> 'array' or jsonb_array_length(p_arvore) = 0 then
    return array['A árvore precisa ser um array de nós, com ao menos um nó.'];
  end if;

  select array_agg(n ->> 'id') into v_ids from jsonb_array_elements(p_arvore) n;
  if not ('abertura' = any (v_ids)) then
    v_erros := v_erros || 'Falta o nó "abertura".'::text;
  end if;
  if (select count(distinct i) from unnest(v_ids) i) <> cardinality(v_ids) then
    v_erros := v_erros || 'Há ids de nó repetidos.'::text;
  end if;

  for v_no in select n from jsonb_array_elements(p_arvore) n loop
    if coalesce(v_no ->> 'id', '') !~ '^[a-z0-9_]+$' then
      v_erros := v_erros || format('Id de nó inválido: %s.', coalesce(v_no ->> 'id', '(vazio)'));
    end if;
    if (v_no ->> 'tipo') not in ('fala','pergunta','captura','objecao','acao','fim') then
      v_erros := v_erros || format('"%s" tem tipo desconhecido: %s.', v_no ->> 'id', v_no ->> 'tipo');
    end if;
    if (v_no ->> 'variante') not in ('ambas','captacao','fornecedor','produtor','ativacao') then
      v_erros := v_erros || format('"%s" tem variante desconhecida: %s.', v_no ->> 'id', v_no ->> 'variante');
    end if;
    if length(trim(coalesce(v_no ->> 'texto', ''))) = 0 then
      v_erros := v_erros || format('"%s" não tem texto para falar.', v_no ->> 'id');
    end if;
    if (v_no ->> 'tipo') = 'captura' and coalesce(v_no ->> 'campo', '') = '' then
      v_erros := v_erros || format('"%s" é captura e não diz em que campo guarda a resposta.', v_no ->> 'id');
    end if;

    for v_saida in select s from jsonb_array_elements(coalesce(v_no -> 'saidas', '[]'::jsonb)) s loop
      if not ((v_saida ->> 'destino') = any (v_ids)) then
        v_erros := v_erros || format('"%s" aponta para "%s", que não existe.',
                                     v_no ->> 'id', v_saida ->> 'destino');
      end if;
      if length(coalesce(v_saida ->> 'rotulo', '')) not between 1 and 48 then
        v_erros := v_erros || format('"%s" tem botão sem rótulo ou com mais de 48 caracteres.', v_no ->> 'id');
      end if;
    end loop;

    if (v_no ->> 'tipo') = 'fim' then
      if (v_no ->> 'desfecho') is null and (v_no ->> 'resultadoTecnico') is null then
        v_erros := v_erros || format('"%s" é fim e não fecha por nenhum dos dois eixos.', v_no ->> 'id');
      elsif (v_no ->> 'desfecho') is not null and (v_no ->> 'resultadoTecnico') is not null then
        v_erros := v_erros || format('"%s" fecha pelos dois eixos ao mesmo tempo.', v_no ->> 'id');
      elsif (v_no ->> 'desfecho') is not null
            and (v_no ->> 'desfecho') not in ('lig_atendeu_retorna','lig_interessado','lig_agora_nao',
                                              'lig_sem_interesse','lig_reuniao_marcada') then
        v_erros := v_erros || format('"%s" usa o desfecho "%s", que não é comercial de ligação.',
                                     v_no ->> 'id', v_no ->> 'desfecho');
      end if;
    elsif jsonb_array_length(coalesce(v_no -> 'saidas', '[]'::jsonb)) = 0
          and (v_no ->> 'tipo') <> 'acao' then
      v_erros := v_erros || format('"%s" não tem saída e não é fim: a ligação trava aqui.', v_no ->> 'id');
    end if;
  end loop;

  -- Por variante: nó que vale na variante e não é fim nem ação precisa de ao menos
  -- uma saída cujo DESTINO também valha nela.
  -- A ativação só é conferida em árvore que TEM ativação: a v2 (dois caminhos) continua
  -- válida, e é ela que os lotes montados antes da v3 seguem lendo.
  v_variantes := array['fornecedor','produtor'];
  if exists (select 1 from jsonb_array_elements(p_arvore) n where n ->> 'variante' = 'ativacao') then
    v_variantes := v_variantes || 'ativacao'::text;
    foreach v_entrada in array array['ativ_abertura_perfil','ativ_abertura_pedido',
                                     'ativ_abertura_respondido','ativ_abertura_reativar'] loop
      if not (v_entrada = any (v_ids)) then
        v_erros := v_erros || format('Falta o nó de entrada da ativação "%s".', v_entrada);
      end if;
    end loop;
  end if;

  foreach v_variante in array v_variantes loop
    for v_no in select n from jsonb_array_elements(p_arvore) n loop
      continue when not app.no_vale_na_variante(v_no ->> 'variante', v_variante);
      continue when (v_no ->> 'tipo') in ('fim','acao');
      v_sobrou := false;
      for v_saida in select s from jsonb_array_elements(coalesce(v_no -> 'saidas', '[]'::jsonb)) s loop
        select n into v_destino
          from jsonb_array_elements(p_arvore) n
         where n ->> 'id' = v_saida ->> 'destino'
         limit 1;
        if v_destino is not null and app.no_vale_na_variante(v_destino ->> 'variante', v_variante) then
          v_sobrou := true;
        end if;
      end loop;
      if not v_sobrou then
        v_erros := v_erros || format('"%s" fica sem saída na variante %s.', v_no ->> 'id', v_variante);
      end if;
    end loop;
  end loop;

  return v_erros;
end $$;
comment on function app.validar_roteiro(jsonb) is
  'Erros estruturais de um roteiro em árvore (R13 §3.2). Espelho de validarRoteiro em components/ligacao/tipos.ts: abertura presente, entradas da ativação presentes quando a árvore tem ativação, destinos existentes, fim fechando por exatamente um eixo, e nenhum nó sem saída em nenhuma das variantes (fornecedor, produtor e, quando existe, ativacao).';
revoke all on function app.validar_roteiro(jsonb) from public, anon;
grant execute on function app.validar_roteiro(jsonb) to authenticated, service_role;

alter table public.call_attempts drop constraint if exists call_attempts_variante_check;
alter table public.call_attempts add constraint call_attempts_variante_check
  check (variante is null or variante in ('fornecedor', 'produtor', 'ativacao'));


-- ===========================================================================
-- 2. A variante sai do funil do lote; a entrada da ativação, da etapa
-- ===========================================================================
create or replace function public.proximo_da_fila(p_lote_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_role    app.user_role;
  v_hoje    date := (now() at time zone 'America/Fortaleza')::date;
  b         public.call_batches%rowtype;
  i         public.call_batch_items%rowtype;
  v_janela  jsonb;
  v_org     public.organizations%rowtype;
  v_contato public.contacts%rowtype;
  v_restam  int;
  v_voltas  int := 0;
  v_achou   boolean := false;
  v_variante text;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  v_role := app.role();
  if not app.can_write() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao', 'detalhe', null);
  end if;

  select * into b from public.call_batches where id = p_lote_id;
  if not found or not (app.is_manager() or b.owner_id = v_uid) then
    return jsonb_build_object('ok', false, 'motivo', 'lote_de_outro_dono', 'detalhe', null);
  end if;
  if b.status <> 'ativo'::app.call_batch_status then
    return jsonb_build_object('ok', false, 'motivo', 'lote_encerrado', 'detalhe', b.status::text);
  end if;
  if v_hoje < b.starts_on or v_hoje > b.ends_on then
    return jsonb_build_object('ok', false, 'motivo', 'fora_do_periodo',
                              'detalhe', b.starts_on::text || '..' || b.ends_on::text);
  end if;

  -- ----- a janela, antes de tudo (R13 §6) -----
  v_janela := app.call_window(now());
  if not (v_janela ->> 'aberta')::boolean then
    return jsonb_build_object('ok', false, 'motivo', 'fora_da_janela',
                              'detalhe', v_janela ->> 'motivo',
                              'abre_em', v_janela -> 'abre_em');
  end if;

  -- Reserva vencida do PRÓPRIO lote volta para a fila antes da escolha: quem
  -- abandonou uma ligação há 40 minutos não pode ser o motivo de a fila parecer vazia.
  update public.call_batch_items x
     set status = 'fila'::app.call_item_status, reserved_until = null, reserved_by = null
   where x.batch_id = b.id
     and x.status = 'em_andamento'::app.call_item_status
     and x.reserved_until < now();

  -- ----- o próximo -----
  -- Uma regra só se sobrepõe à posição congelada, e ela vem do cliente e não do
  -- sistema: item reagendado e vencido vai para o topo, pelo horário combinado.
  -- "Me liga terça às 10h" é a única promessa que a fila tem de cumprir.
  loop
    v_voltas := v_voltas + 1;
    exit when v_voltas > 50;

    select * into i
      from public.call_batch_items x
     where x.batch_id = b.id
       and x.status = 'fila'::app.call_item_status
       and (x.scheduled_at is null or x.scheduled_at <= now())
       and x.attempts < b.max_attempts
       and (x.last_attempt_at is null
            or x.last_attempt_at <= now() - make_interval(hours => b.min_hours_between_attempts))
     order by (x.scheduled_at is not null) desc, x.scheduled_at nulls last, x.position
     limit 1
       for update skip locked;

    if not found then
      -- §3.12d: nomear o que aconteceu. "Fila vazia" era a resposta para três
      -- situações diferentes, e duas delas têm ação.
      return app.motivo_da_fila_vazia(b.id);
    end if;

    -- ----- guardrail: alguém pode ter pedido opt-out DEPOIS de o lote ser montado -----
    select * into v_org from public.organizations where id = i.organization_id;
    if v_org.deleted_at is not null
       or app.is_suppressed_target(i.organization_id, i.contact_id) then
      update public.call_batch_items x
         set status = 'devolvido'::app.call_item_status,
             reserved_until = null, reserved_by = null,
             note = coalesce(x.note, 'contato suprimido depois da montagem')
       where x.id = i.id;
      continue;
    end if;

    v_achou := true;
    exit;
  end loop;

  if not v_achou then
    return app.motivo_da_fila_vazia(b.id);
  end if;

  -- ----- a reserva de trabalho -----
  update public.call_batch_items x
     set status = 'em_andamento'::app.call_item_status,
         reserved_until = now() + interval '30 minutes',
         reserved_by = v_uid
   where x.id = i.id
  returning * into i;

  if i.contact_id is not null then
    select * into v_contato from public.contacts where id = i.contact_id;
  end if;

  v_variante := app.variante_da_ligacao(b.id, v_org.kind);

  -- §3.12e: o número de trabalho não conta quem já não pode ser ligado.
  v_restam := app.itens_restantes_do_lote(b.id);

  -- Revelar o telefone é ato registrado (RF-BAS-14, RF-ADM-03), aqui como no reveal_phone.
  insert into public.pii_access_log (actor_id, actor_role, action, entity_type, entity_id, scope)
  values (v_uid, v_role::text, 'reveal_phone', 'organization', i.organization_id,
          jsonb_build_object('origem', 'proximo_da_fila', 'lote_id', b.id, 'item_id', i.id));

  return jsonb_build_object(
    'ok', true,
    'item', jsonb_build_object(
      'id',                i.id,
      'lote_id',           b.id,
      'organization_id',   i.organization_id,
      'nome',              v_org.name,
      'kind',              v_org.kind,
      'categoria',         (select c.name from public.organization_categories oc
                              join public.categories c on c.id = oc.category_id
                             where oc.organization_id = v_org.id
                             order by oc.is_primary desc limit 1),
      'bairro',            v_org.neighborhood,
      'cidade',            (select c.name from public.cities c where c.id = v_org.city_id),
      'telefone',          i.phone_e164,
      'contato_id',        i.contact_id,
      'contato_nome',      coalesce(v_contato.first_name, v_contato.full_name),
      'origem_slug',       (select s.slug from public.sources s where s.id = v_org.source_id),
      'origem_url',        v_org.source_url,
      'deal_id',           i.deal_id,
      'etapa_id',          i.stage_id,
      'etapa',             (select s.name from public.stages s where s.id = i.stage_id),
      'temperatura',       v_org.temperature,
      'status',            i.status,
      'posicao',           i.position,
      'tentativas',        i.attempts,
      'agendado_para',     i.scheduled_at,
      'ultima_tentativa_em', i.last_attempt_at,
      'reservado_ate',     i.reserved_until,
      'observacao',        i.note),
    'roteiro', jsonb_build_object(
      'id',     b.script_id,
      'versao', b.script_version,
      'arvore', (select s.arvore from public.call_scripts s where s.id = b.script_id)),
    'variante', v_variante,
    -- Por onde a fala começa: a abertura da captação, ou a da ativação que a etapa
    -- ATUAL do negócio pede (a etapa do item é a da montagem e pode ter andado).
    'entrada',  app.entrada_da_ligacao(v_variante,
                  coalesce((select d.stage_id from public.deals d where d.id = i.deal_id), i.stage_id)),
    'restantes', v_restam,
    'fecha_em', v_janela -> 'fecha_em');
end $$;
comment on function public.proximo_da_fila(uuid) is
  'Entrega o próximo contato do lote com trava (for update skip locked), revela o telefone com registro em pii_access_log (RF-BAS-14) e recusa com motivo nomeado: fora_da_janela (domingo, feriado, antes/depois do horário — R13 §6), lote_encerrado, fora_do_periodo, lote_de_outro_dono, fila_vazia. Devolve a variante do roteiro pelo funil do lote (app.variante_da_ligacao) e o nó de entrada (app.entrada_da_ligacao). Quando a fila não entrega ninguém, o `detalhe` diz por quê — aguardando_intervalo (com `volta_em`) ou tentativas_esgotadas (laudo §3.12d). "restantes" não conta contato suprimido (§3.12e). Contato que virou suprimido depois da montagem sai do lote em vez de ser entregue (RF-CON-18).';
revoke all on function public.proximo_da_fila(uuid) from public, anon;
grant execute on function public.proximo_da_fila(uuid) to authenticated, service_role;

create or replace function public.iniciar_chamada(p_item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_role   app.user_role;
  i        public.call_batch_items%rowtype;
  b        public.call_batches%rowtype;
  v_janela jsonb;
  v_org    public.organizations%rowtype;
  v_att    uuid;
  v_kind   app.org_kind;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  v_role := app.role();
  if not app.can_write() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao', 'detalhe', null);
  end if;

  select * into i from public.call_batch_items where id = p_item_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'reserva_expirada', 'detalhe', 'item_inexistente');
  end if;
  select * into b from public.call_batches where id = i.batch_id;
  if not (app.is_manager() or b.owner_id = v_uid) then
    return jsonb_build_object('ok', false, 'motivo', 'item_de_outro_dono', 'detalhe', null);
  end if;
  if b.status <> 'ativo'::app.call_batch_status then
    return jsonb_build_object('ok', false, 'motivo', 'lote_encerrado', 'detalhe', b.status::text);
  end if;
  if i.status <> 'em_andamento'::app.call_item_status
     or i.reserved_by is distinct from v_uid
     or i.reserved_until is null or i.reserved_until < now() then
    return jsonb_build_object('ok', false, 'motivo', 'reserva_expirada', 'detalhe', i.status::text);
  end if;

  v_janela := app.call_window(now());
  if not (v_janela ->> 'aberta')::boolean then
    return jsonb_build_object('ok', false, 'motivo', 'fora_da_janela',
                              'detalhe', v_janela ->> 'motivo', 'abre_em', v_janela -> 'abre_em');
  end if;

  if i.attempts >= b.max_attempts then
    return jsonb_build_object('ok', false, 'motivo', 'teto_de_tentativas', 'detalhe', b.max_attempts::text);
  end if;

  select * into v_org from public.organizations where id = i.organization_id;
  if v_org.deleted_at is not null or app.is_suppressed_target(i.organization_id, i.contact_id) then
    update public.call_batch_items x
       set status = 'devolvido'::app.call_item_status, reserved_until = null, reserved_by = null,
           note = coalesce(x.note, 'contato suprimido depois da montagem')
     where x.id = i.id;
    return jsonb_build_object('ok', false, 'motivo', 'contato_suprimido', 'detalhe', null);
  end if;
  v_kind := v_org.kind;

  -- Chamada já aberta para este item (aba duplicada, toque duplo): devolve a mesma,
  -- em vez de abrir uma segunda tentativa e contar duas vezes.
  select a.id into v_att
    from public.call_attempts a
   where a.item_id = i.id and a.encerrada_em is null
   limit 1;

  if v_att is null then
    insert into public.call_attempts
      (item_id, batch_id, organization_id, contact_id, user_id, provedor,
       script_id, script_version, variante, iniciada_em)
    values
      (i.id, b.id, i.organization_id, i.contact_id, v_uid, 'manual',
       b.script_id, b.script_version,
       app.variante_da_ligacao(b.id, v_kind),
       now())
    returning id into v_att;

    update public.call_batch_items x
       set attempts = x.attempts + 1,
           last_attempt_at = now(),
           reserved_until = now() + interval '30 minutes'
     where x.id = i.id;

    insert into public.pii_access_log (actor_id, actor_role, action, entity_type, entity_id, scope)
    values (v_uid, v_role::text, 'reveal_phone', 'organization', i.organization_id,
            jsonb_build_object('origem', 'iniciar_chamada', 'attempt_id', v_att));
  end if;

  return jsonb_build_object(
    'ok', true,
    'chamada', jsonb_build_object(
      'id',          v_att,
      'item_id',     i.id,
      'telefone',    i.phone_e164,
      'iniciada_em', (select a.iniciada_em from public.call_attempts a where a.id = v_att),
      'provedor',    'manual'));
end $$;
comment on function public.iniciar_chamada(uuid) is
  'Abre a tentativa de ligação (call_attempts, com a variante do funil do lote), conta a tentativa, estende a reserva e devolve o telefone para o link tel: — com registro em pii_access_log. Recusa com motivo nomeado: fora_da_janela, contato_suprimido, teto_de_tentativas, reserva_expirada, item_de_outro_dono, lote_encerrado.';
revoke all on function public.iniciar_chamada(uuid) from public, anon;
grant execute on function public.iniciar_chamada(uuid) to authenticated, service_role;


-- ===========================================================================
-- 3. Quem já contrata pela Komune não entra em lote de ativação
-- ===========================================================================
create or replace function app.call_candidates(
  p_pipeline_id        int,
  p_temperatura_origem app.temperature,
  p_categoria_ids      int[],
  p_ordem              app.call_order,
  p_seed               int)
returns table (
  organization_id uuid,
  contact_id      uuid,
  phone_e164      text,
  deal_id         uuid,
  stage_id        int,
  motivo          text,
  ordem           bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id,
         d.primary_contact_id,
         o.phone_e164,
         d.id,
         d.stage_id,
         case
           when o.do_not_contact                                      then 'nao_contatar'
           when app.is_suppressed_target(o.id, d.primary_contact_id)  then 'suprimido'
           when nullif(trim(coalesce(o.phone_e164, '')), '') is null  then 'sem_telefone'
           when d.status <> 'open'::app.deal_status                   then 'sem_negocio_aberto'
           -- Ativação: quem já fechou serviço pela Komune não precisa de ligação de
           -- ativação. As mesmas etapas existem com o mesmo slug em outro funil
           -- ("recorrente" do produtor), por isso a conferência é do funil do lote.
           when st.slug in ('primeira_contratacao', 'recorrente')
            and (select p.slug from public.pipelines p where p.id = p_pipeline_id) = 'ativacao'
                                                                      then 'etapa_sem_ligacao'
           when d.temperature <> p_temperatura_origem                 then 'temperatura_diferente'
           when coalesce(cd.blocked_forever, false)                   then 'em_janela_de_recontato'
           when cd.cooldown_until > now()                             then 'em_janela_de_recontato'
           when exists (select 1 from public.call_batch_items r
                         where r.status in ('fila'::app.call_item_status,
                                            'em_andamento'::app.call_item_status)
                           and (r.organization_id = o.id or r.phone_e164 = o.phone_e164))
                                                                      then 'reservado_em_outro_lote'
           else null
         end,
         row_number() over (
           order by
             case when p_ordem = 'prioridade'::app.call_order
                  then case d.tier when 'A+' then 4 when 'A' then 3 when 'B' then 2 when 'C' then 1 else 0 end
                  else 0 end desc,
             case when p_ordem = 'prioridade'::app.call_order
                  then coalesce(d.score, -1) else 0 end desc,
             case when p_ordem = 'aleatorio'::app.call_order
                  then md5(p_seed::text || o.id::text) else '' end,
             case when p_ordem <> 'aleatorio'::app.call_order
                  then coalesce(d.last_activity_at, 'epoch'::timestamptz) end asc,
             o.name)
    from public.organizations o
    join public.deals d
      on d.organization_id = o.id
     and d.pipeline_id = p_pipeline_id
    left join public.stages st on st.id = d.stage_id
    left join public.v_contact_cooldown cd on cd.organization_id = o.id
   where o.deleted_at is null
     and app.org_is_visible(o.id)
     and (cardinality(coalesce(p_categoria_ids, '{}'::int[])) = 0
          or exists (select 1 from public.organization_categories oc
                      where oc.organization_id = o.id
                        and oc.category_id = any (p_categoria_ids)))
$$;
comment on function app.call_candidates(int, app.temperature, int[], app.call_order, int) is
  'Candidatos de um lote de ligação, com o motivo de exclusão de cada um (null = entra) e a ordem congelada da fila (R13 §3.1). Os motivos são avaliados por GRAVIDADE — nao_contatar e suprimido antes de sem_negocio_aberto (D8) —, porque o opt-out fecha o negócio e sem essa ordem ele aparecia como "sem negócio aberto". No funil de ativação, quem está em primeira_contratacao ou recorrente sai com etapa_sem_ligacao. Devolve telefone: só as RPCs security definer do módulo a executam.';
revoke all on function app.call_candidates(int, app.temperature, int[], app.call_order, int)
  from public, anon, authenticated;


-- ===========================================================================
-- 4. O roteiro v3: três caminhos
-- ===========================================================================
-- A v2 sai de publicação e FICA na tabela: o lote congela script_id e versão na
-- montagem, e os lotes montados com ela continuam lendo a árvore dela.
update public.call_scripts set is_published = false
 where slug = 'captacao_v1' and is_published and versao <> 3;

insert into public.call_scripts (slug, nome, versao, arvore, is_published)
values ('captacao_v1', 'Ligação — fornecedor, produtor e ativação (v3)', 3, $roteiro$[
  {
    "id": "abertura",
    "tipo": "pergunta",
    "variante": "captacao",
    "texto": "[saudacao], tudo bem? Aqui é [eu], da Komune. Falo com [interlocutor]?",
    "saidas": [
      {
        "rotulo": "Sou eu",
        "destino": "permissao"
      },
      {
        "rotulo": "Não é comigo",
        "destino": "pedir_decisor"
      },
      {
        "rotulo": "Não posso falar agora",
        "destino": "obj_sem_tempo"
      },
      {
        "rotulo": "Tô dirigindo / no meio de um evento",
        "destino": "combinar_retorno"
      },
      {
        "rotulo": "Aqui não é [empresa]",
        "destino": "fim_engano"
      },
      {
        "rotulo": "Somos, mas não trabalhamos com evento",
        "destino": "fim_nao_e_evento"
      },
      {
        "rotulo": "Desligou no meio",
        "destino": "fim_desligou"
      }
    ],
    "nota": "Confirmar com quem está falando antes de qualquer outra coisa. Sem nome na ficha, a pergunta vira \"quem cuida dos eventos aí\"."
  },
  {
    "id": "permissao",
    "tipo": "pergunta",
    "variante": "captacao",
    "texto": "Vou ser bem direto pra respeitar seu tempo, [nome]. Peguei o contato de vocês [origem], e se não fizer sentido é só me dizer que eu tiro da lista. Posso tomar um minutinho?",
    "saidas": [
      {
        "rotulo": "Pode falar",
        "destino": "forn_quem_somos"
      },
      {
        "rotulo": "Pode falar",
        "destino": "prod_quem_somos"
      },
      {
        "rotulo": "Agora não dá",
        "destino": "obj_sem_tempo"
      },
      {
        "rotulo": "De onde tirou meu número?",
        "destino": "obj_origem"
      },
      {
        "rotulo": "Quem é você? Isso é golpe?",
        "destino": "obj_golpe"
      },
      {
        "rotulo": "Tira da lista, não quero",
        "destino": "fim_optout"
      },
      {
        "rotulo": "Desligou no meio",
        "destino": "fim_desligou"
      }
    ],
    "nota": "Pedir permissão aumenta a escuta. A origem do contato e o jeito de sair da lista são obrigação de LGPD (R06): as duas meias frases não saem."
  },
  {
    "id": "forn_quem_somos",
    "tipo": "fala",
    "variante": "fornecedor",
    "texto": "A Komune é um aplicativo criado aqui em Natal que conecta quem está organizando um evento — aniversário, casamento, formatura, evento de empresa — com os fornecedores da cidade. A pessoa monta o evento pelo app e contrata os fornecedores por lá mesmo.",
    "saidas": [
      {
        "rotulo": "Seguir",
        "destino": "forn_motivo"
      }
    ]
  },
  {
    "id": "forn_motivo",
    "tipo": "fala",
    "variante": "fornecedor",
    "texto": "A gente está cadastrando os primeiros fornecedores parceiros, e [area] é uma das categorias que os clientes mais procuram. Por isso liguei pra vocês.",
    "saidas": [
      {
        "rotulo": "Seguir",
        "destino": "forn_valor"
      }
    ]
  },
  {
    "id": "forn_valor",
    "tipo": "fala",
    "variante": "fornecedor",
    "texto": "O principal: estar na Komune é de graça. Não tem mensalidade, adesão nem custo fixo — vocês só pagam quando fecham um serviço pela plataforma. E quem entra agora já está lá quando os clientes da cidade começarem a procurar.",
    "saidas": [
      {
        "rotulo": "Seguir",
        "destino": "forn_fechamento"
      },
      {
        "rotulo": "Quanto é a taxa?",
        "destino": "obj_taxa"
      }
    ],
    "nota": "Ênfase na gratuidade de estar na plataforma. O número da taxa não se diz na ligação: quem mostra a conta é a apresentação."
  },
  {
    "id": "forn_fechamento",
    "tipo": "pergunta",
    "variante": "fornecedor",
    "texto": "O que eu queria era marcar 20 minutos pra te mostrar a plataforma por dentro e como funciona o cadastro. Pra você fica melhor [opcao1] ou [opcao2]? Pode ser por vídeo ou eu passo aí.",
    "saidas": [
      {
        "rotulo": "Escolheu um dos dois horários",
        "destino": "confirmar_whatsapp"
      },
      {
        "rotulo": "Quer outro dia",
        "destino": "agendar_outro_dia"
      },
      {
        "rotulo": "Manda no WhatsApp",
        "destino": "obj_whatsapp"
      },
      {
        "rotulo": "Quanto é a taxa?",
        "destino": "obj_taxa"
      },
      {
        "rotulo": "Não sou eu quem decide",
        "destino": "obj_nao_decide"
      },
      {
        "rotulo": "Não tenho interesse",
        "destino": "obj_sem_interesse"
      },
      {
        "rotulo": "Não me ligue mais",
        "destino": "fim_optout"
      }
    ],
    "nota": "Sempre duas opções concretas, nunca \"podemos marcar?\". Toque no horário que a pessoa escolheu antes de seguir."
  },
  {
    "id": "obj_taxa",
    "tipo": "objecao",
    "variante": "fornecedor",
    "texto": "Custo fixo, nenhum: estar na Komune é de graça, e só existe custo quando vocês fecham negócio por lá. Na apresentação eu te mostro direitinho como funciona. São 20 minutos: [opcao1] ou [opcao2]?",
    "saidas": [
      {
        "rotulo": "Escolheu um dos dois horários",
        "destino": "confirmar_whatsapp"
      },
      {
        "rotulo": "Mas quanto é?",
        "destino": "forn_taxa_insiste"
      },
      {
        "rotulo": "Quer outro dia",
        "destino": "agendar_outro_dia"
      },
      {
        "rotulo": "Manda no WhatsApp",
        "destino": "obj_whatsapp"
      },
      {
        "rotulo": "Não tenho interesse",
        "destino": "obj_sem_interesse"
      }
    ],
    "nota": "Não diga o percentual. O foco é a reunião, com ênfase no que é de graça."
  },
  {
    "id": "forn_taxa_insiste",
    "tipo": "pergunta",
    "variante": "fornecedor",
    "texto": "É um percentual só do serviço que fechar pela Komune. Não sai nada do seu bolso antes disso. Te mostro a conta certinha na apresentação: [opcao1] ou [opcao2]?",
    "saidas": [
      {
        "rotulo": "Escolheu um dos dois horários",
        "destino": "confirmar_whatsapp"
      },
      {
        "rotulo": "Quer outro dia",
        "destino": "agendar_outro_dia"
      },
      {
        "rotulo": "Manda no WhatsApp",
        "destino": "obj_whatsapp"
      },
      {
        "rotulo": "Não tenho interesse",
        "destino": "obj_sem_interesse"
      }
    ],
    "nota": "Resposta para quem insiste pela segunda vez. Honesta sem dizer o número; se insistir de novo, combine a apresentação e não argumente mais."
  },
  {
    "id": "obj_concorrente",
    "tipo": "objecao",
    "variante": "fornecedor",
    "texto": "Conheço, e não vim pedir pra você sair de lá. A diferença é a conta: lá você paga pela posição, feche ou não. Na Komune, estar lá é de graça, e custo só existe quando fecha. Dá pra ter os dois. Te mostro a diferença: [opcao1] ou [opcao2]?",
    "saidas": [
      {
        "rotulo": "Escolheu um dos dois horários",
        "destino": "confirmar_whatsapp"
      },
      {
        "rotulo": "Quer outro dia",
        "destino": "agendar_outro_dia"
      },
      {
        "rotulo": "De lá já chega cliente bom",
        "destino": "forn_valor"
      },
      {
        "rotulo": "Por enquanto não",
        "destino": "fim_agora_nao"
      }
    ],
    "nota": "Nunca ataque o concorrente: complemente (R08 §1, intenção 4)."
  },
  {
    "id": "obj_nao_preciso",
    "tipo": "objecao",
    "variante": "fornecedor",
    "texto": "Que bom, é o melhor problema de se ter. E é justamente quem já é referência na cidade que a gente quer entre os primeiros parceiros. Estar na Komune não custa nada, e vocês aceitam só o pedido que quiserem. Faz sentido eu te mostrar em 20 minutos?",
    "saidas": [
      {
        "rotulo": "Faz, vamos marcar",
        "destino": "forn_fechamento"
      },
      {
        "rotulo": "Me procura mais pra frente",
        "destino": "combinar_retorno"
      },
      {
        "rotulo": "Não, valeu",
        "destino": "fim_sem_interesse"
      }
    ],
    "nota": "Concorde, não insista que a pessoa precisa (R08 §2.0)."
  },
  {
    "id": "obj_mais_um_app",
    "tipo": "objecao",
    "variante": "fornecedor",
    "texto": "Vocês não precisam mudar o jeito de trabalhar. O pedido chega com a data e o número de pessoas já escritos, e o cadastro a gente faz junto com você. Assim ainda parece mais um app?",
    "saidas": [
      {
        "rotulo": "Assim tudo bem, me mostra",
        "destino": "forn_fechamento"
      },
      {
        "rotulo": "E quanto custa isso?",
        "destino": "obj_taxa"
      },
      {
        "rotulo": "Mesmo assim, não quero",
        "destino": "fim_agora_nao"
      }
    ],
    "nota": "Só prometa o que a FAQ cobre: busca, vitrine com avaliação e o pedido chegando com data e número de pessoas."
  },
  {
    "id": "obj_meu_preco",
    "tipo": "objecao",
    "variante": "fornecedor",
    "texto": "O preço é de vocês. A Komune não tabela e não pede desconto. E o cliente vê o trabalho, as fotos e as avaliações antes de pedir. Era isso que te preocupava?",
    "saidas": [
      {
        "rotulo": "Era, e assim tá certo",
        "destino": "forn_fechamento"
      },
      {
        "rotulo": "E vocês ficam com quanto?",
        "destino": "obj_taxa"
      },
      {
        "rotulo": "Mesmo assim, não",
        "destino": "fim_sem_interesse"
      }
    ],
    "nota": "Nunca prometa que o fornecedor vai vender mais caro nem que o cliente paga mais (R08 §5.4)."
  },
  {
    "id": "prod_quem_somos",
    "tipo": "fala",
    "variante": "produtor",
    "texto": "A Komune é um aplicativo criado aqui em Natal pra quem organiza evento. Você monta o evento no app e contrata os fornecedores da cidade por lá, com preço e avaliação na tela, tudo num lugar só.",
    "saidas": [
      {
        "rotulo": "Seguir",
        "destino": "prod_motivo"
      }
    ]
  },
  {
    "id": "prod_motivo",
    "tipo": "fala",
    "variante": "produtor",
    "texto": "A gente está escolhendo os primeiros organizadores parceiros, e quem organiza evento como vocês é quem mais aproveita. Por isso liguei.",
    "saidas": [
      {
        "rotulo": "Seguir",
        "destino": "prod_valor"
      }
    ]
  },
  {
    "id": "prod_valor",
    "tipo": "fala",
    "variante": "produtor",
    "texto": "O principal: pra você não tem custo nenhum. E você ainda recebe 5% de tudo que contratar de fornecedor pela Komune, depois que o fornecedor entrega o serviço.",
    "saidas": [
      {
        "rotulo": "Seguir",
        "destino": "prod_fechamento"
      },
      {
        "rotulo": "Como assim eu recebo?",
        "destino": "obj_pegadinha"
      }
    ],
    "nota": "Os 5% são do organizador que contratou pela plataforma, pagos depois da entrega confirmada. Não prometa prazo de repasse: isso é do financeiro."
  },
  {
    "id": "prod_fechamento",
    "tipo": "pergunta",
    "variante": "produtor",
    "texto": "Queria marcar 20 minutos pra te mostrar um evento montado por dentro e como funcionam esses 5%. Fica melhor [opcao1] ou [opcao2]? Pode ser por vídeo ou eu passo aí.",
    "saidas": [
      {
        "rotulo": "Escolheu um dos dois horários",
        "destino": "confirmar_whatsapp"
      },
      {
        "rotulo": "Quer outro dia",
        "destino": "agendar_outro_dia"
      },
      {
        "rotulo": "Como assim eu recebo?",
        "destino": "obj_pegadinha"
      },
      {
        "rotulo": "Manda no WhatsApp",
        "destino": "obj_whatsapp"
      },
      {
        "rotulo": "Não sou eu quem decide",
        "destino": "obj_nao_decide"
      },
      {
        "rotulo": "Não tenho interesse",
        "destino": "obj_sem_interesse"
      },
      {
        "rotulo": "Não me ligue mais",
        "destino": "fim_optout"
      }
    ],
    "nota": "Sempre duas opções concretas. Toque no horário que a pessoa escolheu antes de seguir."
  },
  {
    "id": "obj_pegadinha",
    "tipo": "objecao",
    "variante": "produtor",
    "texto": "Sem pegadinha: quem paga é o fornecedor, e só quando fecha pela Komune. Uma parte volta pra quem organizou e contratou: 5%, depois que o serviço é entregue. Te mostro na prática: [opcao1] ou [opcao2]?",
    "saidas": [
      {
        "rotulo": "Escolheu um dos dois horários",
        "destino": "confirmar_whatsapp"
      },
      {
        "rotulo": "Quer outro dia",
        "destino": "agendar_outro_dia"
      },
      {
        "rotulo": "Isso é comissão por fora?",
        "destino": "obj_por_fora"
      },
      {
        "rotulo": "Não tenho interesse",
        "destino": "obj_sem_interesse"
      }
    ],
    "nota": "Não diga quanto o fornecedor paga. O que se diz ao organizador é o que ele recebe."
  },
  {
    "id": "obj_por_fora",
    "tipo": "objecao",
    "variante": "produtor",
    "texto": "Não é por fora: o repasse é feito pela própria plataforma, com comprovante, depois da entrega. Fica tudo registrado. Faz sentido eu te mostrar como aparece?",
    "saidas": [
      {
        "rotulo": "Faz, vamos marcar",
        "destino": "prod_fechamento"
      },
      {
        "rotulo": "Vou pensar",
        "destino": "obj_vou_pensar"
      },
      {
        "rotulo": "Mesmo assim, não quero",
        "destino": "fim_sem_interesse"
      }
    ]
  },
  {
    "id": "obj_ja_tenho",
    "tipo": "objecao",
    "variante": "produtor",
    "texto": "E eles continuam seus. Dá até pra trazer eles pra Komune: aí você contrata os mesmos de sempre e ainda recebe os 5%. Vale eu te mostrar como fica?",
    "saidas": [
      {
        "rotulo": "Vale, vamos marcar",
        "destino": "prod_fechamento"
      },
      {
        "rotulo": "Me procura mais pra frente",
        "destino": "combinar_retorno"
      },
      {
        "rotulo": "Não, valeu",
        "destino": "fim_sem_interesse"
      }
    ]
  },
  {
    "id": "obj_honorario",
    "tipo": "objecao",
    "variante": "produtor",
    "texto": "Seu honorário continua o mesmo, cobrado do seu jeito. A Komune não entra no seu contrato com o cliente. Era isso que você queria saber?",
    "saidas": [
      {
        "rotulo": "Era isso, pode seguir",
        "destino": "prod_fechamento"
      },
      {
        "rotulo": "E eu recebo como?",
        "destino": "obj_pegadinha"
      },
      {
        "rotulo": "Mesmo assim, não",
        "destino": "fim_sem_interesse"
      }
    ]
  },
  {
    "id": "obj_mais_um_app_prod",
    "tipo": "objecao",
    "variante": "produtor",
    "texto": "Não é mais um app pra alimentar. É onde para de se perder o que você já faz no WhatsApp e na planilha. E você continua fechando por fora com quem quiser. Quer ver com um evento seu?",
    "saidas": [
      {
        "rotulo": "Quero ver, vamos marcar",
        "destino": "prod_fechamento"
      },
      {
        "rotulo": "Meu jeito de hoje funciona",
        "destino": "obj_ja_tenho"
      },
      {
        "rotulo": "Mesmo assim, não quero",
        "destino": "fim_agora_nao"
      }
    ]
  },
  {
    "id": "obj_whatsapp",
    "tipo": "objecao",
    "variante": "captacao",
    "texto": "Mando agora mesmo. Só que o material sozinho não mostra a plataforma funcionando. Me dá 20 minutos numa chamada que eu te mostro na prática: [opcao1] ou [opcao2]?",
    "saidas": [
      {
        "rotulo": "Escolheu um dos dois horários",
        "destino": "confirmar_whatsapp"
      },
      {
        "rotulo": "Quer outro dia",
        "destino": "agendar_outro_dia"
      },
      {
        "rotulo": "Manda que eu vejo com calma",
        "destino": "fim_material"
      },
      {
        "rotulo": "Tá, e como funciona?",
        "destino": "forn_quem_somos"
      },
      {
        "rotulo": "Tá, e como funciona?",
        "destino": "prod_quem_somos"
      }
    ],
    "nota": "Se insistir, mande o resumo pelo botão do recibo e grave como material enviado."
  },
  {
    "id": "obj_sem_interesse",
    "tipo": "objecao",
    "variante": "captacao",
    "texto": "Sem problema, agradeço seu tempo. Posso só te mandar o material pelo WhatsApp pra você conhecer com calma? Se fizer sentido lá na frente, a porta está aberta.",
    "saidas": [
      {
        "rotulo": "Pode mandar",
        "destino": "fim_agora_nao_material"
      },
      {
        "rotulo": "Não precisa",
        "destino": "fim_sem_interesse"
      },
      {
        "rotulo": "Não me procure mais",
        "destino": "fim_optout"
      }
    ]
  },
  {
    "id": "obj_vou_pensar",
    "tipo": "objecao",
    "variante": "captacao",
    "texto": "Tranquilo. Só pra eu não te encher à toa: o que pesa mais pra decidir? Me diz que eu te mostro exatamente isso na apresentação: [opcao1] ou [opcao2]?",
    "saidas": [
      {
        "rotulo": "Escolheu um dos dois horários",
        "destino": "confirmar_whatsapp"
      },
      {
        "rotulo": "É o custo",
        "destino": "obj_taxa"
      },
      {
        "rotulo": "É o custo",
        "destino": "obj_pegadinha"
      },
      {
        "rotulo": "Me liga semana que vem",
        "destino": "combinar_retorno"
      },
      {
        "rotulo": "Não tenho interesse",
        "destino": "obj_sem_interesse"
      }
    ],
    "nota": "Proibido \"fico no aguardo\" (R08 §2.0). Sem dia marcado, isto não é um sim: é um não devagar."
  },
  {
    "id": "obj_origem",
    "tipo": "objecao",
    "variante": "captacao",
    "texto": "Peguei o contato de vocês [origem]. A gente usa isso só pra convidar quem trabalha com evento aqui de Natal. Se você não quiser mais receber ligação, eu registro agora. O número entra numa lista de bloqueio, e é ela que impede a gente de te procurar de novo. Quer que eu registre, ou dá pra eu contar por que liguei?",
    "saidas": [
      {
        "rotulo": "Pode contar, mas seja rápido",
        "destino": "forn_quem_somos"
      },
      {
        "rotulo": "Pode contar, mas seja rápido",
        "destino": "prod_quem_somos"
      },
      {
        "rotulo": "Não quero mais receber ligação",
        "destino": "fim_optout"
      },
      {
        "rotulo": "Me liga outra hora",
        "destino": "combinar_retorno"
      }
    ],
    "nota": "Transparência de origem é exigência do legítimo interesse (R06). Nunca diga que apaga o contato: o número vai para a suppression_list e fica lá justamente para ninguém voltar a ligar."
  },
  {
    "id": "ativ_abertura_perfil",
    "tipo": "pergunta",
    "variante": "ativacao",
    "texto": "[saudacao], tudo bem? Aqui é [eu], da Komune. Falo com [interlocutor]? É rapidinho, sobre o perfil de vocês na Komune.",
    "saidas": [
      {
        "rotulo": "Sou eu, pode falar",
        "destino": "ativ_perfil"
      },
      {
        "rotulo": "Não é comigo",
        "destino": "pedir_decisor"
      },
      {
        "rotulo": "Não posso falar agora",
        "destino": "obj_sem_tempo"
      },
      {
        "rotulo": "Não quero mais contato",
        "destino": "fim_optout"
      },
      {
        "rotulo": "Desligou no meio",
        "destino": "fim_desligou"
      }
    ],
    "nota": "A etapa do funil escolheu esta abertura. É parceiro, não desconhecido: não precisa dizer de onde veio o contato."
  },
  {
    "id": "ativ_abertura_pedido",
    "tipo": "pergunta",
    "variante": "ativacao",
    "texto": "[saudacao], tudo bem? Aqui é [eu], da Komune. Falo com [interlocutor]? É rapidinho, sobre o perfil de vocês na Komune.",
    "saidas": [
      {
        "rotulo": "Sou eu, pode falar",
        "destino": "ativ_pedido"
      },
      {
        "rotulo": "Não é comigo",
        "destino": "pedir_decisor"
      },
      {
        "rotulo": "Não posso falar agora",
        "destino": "obj_sem_tempo"
      },
      {
        "rotulo": "Não quero mais contato",
        "destino": "fim_optout"
      },
      {
        "rotulo": "Desligou no meio",
        "destino": "fim_desligou"
      }
    ],
    "nota": "A etapa do funil escolheu esta abertura. É parceiro, não desconhecido: não precisa dizer de onde veio o contato."
  },
  {
    "id": "ativ_abertura_respondido",
    "tipo": "pergunta",
    "variante": "ativacao",
    "texto": "[saudacao], tudo bem? Aqui é [eu], da Komune. Falo com [interlocutor]? É rapidinho, sobre o perfil de vocês na Komune.",
    "saidas": [
      {
        "rotulo": "Sou eu, pode falar",
        "destino": "ativ_respondido"
      },
      {
        "rotulo": "Não é comigo",
        "destino": "pedir_decisor"
      },
      {
        "rotulo": "Não posso falar agora",
        "destino": "obj_sem_tempo"
      },
      {
        "rotulo": "Não quero mais contato",
        "destino": "fim_optout"
      },
      {
        "rotulo": "Desligou no meio",
        "destino": "fim_desligou"
      }
    ],
    "nota": "A etapa do funil escolheu esta abertura. É parceiro, não desconhecido: não precisa dizer de onde veio o contato."
  },
  {
    "id": "ativ_abertura_reativar",
    "tipo": "pergunta",
    "variante": "ativacao",
    "texto": "[saudacao], tudo bem? Aqui é [eu], da Komune. Falo com [interlocutor]? É rapidinho, sobre o perfil de vocês na Komune.",
    "saidas": [
      {
        "rotulo": "Sou eu, pode falar",
        "destino": "ativ_reativar"
      },
      {
        "rotulo": "Não é comigo",
        "destino": "pedir_decisor"
      },
      {
        "rotulo": "Não posso falar agora",
        "destino": "obj_sem_tempo"
      },
      {
        "rotulo": "Não quero mais contato",
        "destino": "fim_optout"
      },
      {
        "rotulo": "Desligou no meio",
        "destino": "fim_desligou"
      }
    ],
    "nota": "A etapa do funil escolheu esta abertura. É parceiro, não desconhecido: não precisa dizer de onde veio o contato."
  },
  {
    "id": "ativ_retoma",
    "tipo": "pergunta",
    "variante": "ativacao",
    "texto": "É rapidinho, sobre o perfil de vocês na Komune. Posso falar?",
    "saidas": [
      {
        "rotulo": "Pode falar: completar o perfil",
        "destino": "ativ_perfil"
      },
      {
        "rotulo": "Pode falar: pedido esperando",
        "destino": "ativ_pedido"
      },
      {
        "rotulo": "Pode falar: pedido já respondido",
        "destino": "ativ_respondido"
      },
      {
        "rotulo": "Pode falar: faz tempo sem movimento",
        "destino": "ativ_reativar"
      },
      {
        "rotulo": "Agora não dá",
        "destino": "combinar_retorno"
      }
    ],
    "nota": "Quem atendeu passou a ligação para outra pessoa: toque no motivo que está na etapa do negócio, no topo da tela."
  },
  {
    "id": "ativ_perfil",
    "tipo": "pergunta",
    "variante": "ativacao",
    "texto": "Que bom ter [empresa] com a gente! Liguei porque perfil com fotos dos trabalhos, preços e a conta de recebimento pronta é o que faz o cliente pedir orçamento. Vocês já conseguiram colocar tudo isso?",
    "saidas": [
      {
        "rotulo": "Falta coisa",
        "destino": "ativ_sessao"
      },
      {
        "rotulo": "Travei numa parte",
        "destino": "ativ_sessao"
      },
      {
        "rotulo": "Já está tudo",
        "destino": "fim_perfil_pronto"
      }
    ]
  },
  {
    "id": "ativ_sessao",
    "tipo": "pergunta",
    "variante": "ativacao",
    "texto": "É rápido de resolver. Que tal a gente terminar junto em 15 minutos, por vídeo? Fica melhor [opcao1] ou [opcao2]?",
    "saidas": [
      {
        "rotulo": "Escolheu um dos dois horários",
        "destino": "confirmar_whatsapp"
      },
      {
        "rotulo": "Quer outro dia",
        "destino": "agendar_outro_dia"
      },
      {
        "rotulo": "Faço sozinho, valeu",
        "destino": "fim_resolvido"
      },
      {
        "rotulo": "Me liga depois",
        "destino": "combinar_retorno"
      }
    ]
  },
  {
    "id": "fim_perfil_pronto",
    "tipo": "fim",
    "variante": "ativacao",
    "texto": "Perfeito. Então é só ficar de olho: quando chegar pedido, ele aparece no painel de vocês na Komune. Qualquer dúvida, me chama no WhatsApp.",
    "saidas": [],
    "desfecho": "lig_interessado",
    "nota": "Resolvido na ligação. Nenhuma promessa de que vai chegar pedido."
  },
  {
    "id": "ativ_pedido",
    "tipo": "pergunta",
    "variante": "ativacao",
    "texto": "Liguei porque chegou um pedido de orçamento pra vocês pela Komune e ele ainda está esperando resposta. Pedido parado esfria rápido. Consegue responder hoje? Se ficou alguma dúvida de como fazer, te mostro agora.",
    "saidas": [
      {
        "rotulo": "Respondo hoje",
        "destino": "fim_resposta_combinada"
      },
      {
        "rotulo": "Tive dúvida de como responder",
        "destino": "ativ_duvida"
      },
      {
        "rotulo": "Não vou atender esse pedido",
        "destino": "ativ_motivo_pedido"
      }
    ]
  },
  {
    "id": "ativ_respondido",
    "tipo": "pergunta",
    "variante": "ativacao",
    "texto": "Vi que vocês já responderam o pedido, ótimo! E aí, o cliente deu retorno? Se precisar de ajuda pra fechar, estou aqui.",
    "saidas": [
      {
        "rotulo": "Fechou!",
        "destino": "fim_fechou"
      },
      {
        "rotulo": "Ainda esperando o cliente",
        "destino": "fim_resposta_combinada"
      },
      {
        "rotulo": "Preciso de ajuda pra fechar",
        "destino": "ativ_duvida"
      },
      {
        "rotulo": "Não fechou",
        "destino": "ativ_motivo_pedido"
      }
    ]
  },
  {
    "id": "ativ_duvida",
    "tipo": "pergunta",
    "variante": "ativacao",
    "texto": "Te mostro em 10 minutos agora mesmo, ou a gente marca: [opcao1] ou [opcao2]?",
    "saidas": [
      {
        "rotulo": "Mostrei agora, resolvido",
        "destino": "fim_resolvido"
      },
      {
        "rotulo": "Escolheu um dos dois horários",
        "destino": "confirmar_whatsapp"
      },
      {
        "rotulo": "Quer outro dia",
        "destino": "agendar_outro_dia"
      }
    ]
  },
  {
    "id": "ativ_motivo_pedido",
    "tipo": "captura",
    "variante": "ativacao",
    "texto": "Entendi. Posso saber o motivo? Ajuda a gente a melhorar.",
    "saidas": [
      {
        "rotulo": "Preço",
        "destino": "fim_resolvido",
        "valor": "preço"
      },
      {
        "rotulo": "Data ocupada",
        "destino": "fim_resolvido",
        "valor": "data ocupada"
      },
      {
        "rotulo": "Não é o tipo de evento",
        "destino": "fim_resolvido",
        "valor": "tipo de evento"
      },
      {
        "rotulo": "Outro, já anotei",
        "destino": "fim_resolvido"
      }
    ],
    "campo": "motivo_do_pedido"
  },
  {
    "id": "fim_resposta_combinada",
    "tipo": "fim",
    "variante": "ativacao",
    "texto": "Ótimo. Pedido parado esfria rápido, então quanto antes, melhor. Depois te procuro pra saber como foi. Agradeço seu tempo, [nome]!",
    "saidas": [],
    "desfecho": "lig_interessado"
  },
  {
    "id": "fim_fechou",
    "tipo": "fim",
    "variante": "ativacao",
    "texto": "Que notícia boa! Parabéns pela contratação. Qualquer coisa na entrega, me chama no WhatsApp. Agradeço seu tempo, [nome]!",
    "saidas": [],
    "desfecho": "lig_interessado",
    "nota": "Depois de gravar, mova o negócio para 1ª contratação."
  },
  {
    "id": "ativ_reativar",
    "tipo": "pergunta",
    "variante": "ativacao",
    "texto": "Faz um tempo que não vejo movimento no perfil de [empresa] na Komune, e queria entender: aconteceu alguma coisa, ou tem algo que a gente pode melhorar pra vocês?",
    "saidas": [
      {
        "rotulo": "Ficou difícil usar",
        "destino": "ativ_travou"
      },
      {
        "rotulo": "Não chegou pedido",
        "destino": "ativ_revisar"
      },
      {
        "rotulo": "Tô sem tempo agora",
        "destino": "combinar_retorno"
      },
      {
        "rotulo": "Não quero mais usar",
        "destino": "ativ_motivo_saida"
      }
    ],
    "nota": "Só oferece ajuda. Nenhuma fala promete que vai chegar pedido ou que o perfil vai aparecer mais."
  },
  {
    "id": "ativ_travou",
    "tipo": "pergunta",
    "variante": "ativacao",
    "texto": "Me conta onde travou. Se quiser, reviso o perfil com você em 15 minutos: [opcao1] ou [opcao2]?",
    "saidas": [
      {
        "rotulo": "Escolheu um dos dois horários",
        "destino": "confirmar_whatsapp"
      },
      {
        "rotulo": "Quer outro dia",
        "destino": "agendar_outro_dia"
      },
      {
        "rotulo": "Agora não",
        "destino": "fim_agora_nao"
      }
    ]
  },
  {
    "id": "ativ_revisar",
    "tipo": "pergunta",
    "variante": "ativacao",
    "texto": "Entendi. Vou revisar o perfil com você e ver o que está faltando: [opcao1] ou [opcao2]?",
    "saidas": [
      {
        "rotulo": "Escolheu um dos dois horários",
        "destino": "confirmar_whatsapp"
      },
      {
        "rotulo": "Quer outro dia",
        "destino": "agendar_outro_dia"
      },
      {
        "rotulo": "Agora não",
        "destino": "fim_agora_nao"
      }
    ]
  },
  {
    "id": "ativ_motivo_saida",
    "tipo": "captura",
    "variante": "ativacao",
    "texto": "Tudo bem, agradeço por ter testado. Posso só saber o motivo, pra gente melhorar?",
    "saidas": [
      {
        "rotulo": "Não chegou pedido",
        "destino": "fim_sem_interesse",
        "valor": "não chegou pedido"
      },
      {
        "rotulo": "Difícil de usar",
        "destino": "fim_sem_interesse",
        "valor": "difícil de usar"
      },
      {
        "rotulo": "O custo",
        "destino": "fim_sem_interesse",
        "valor": "custo"
      },
      {
        "rotulo": "Outro, já anotei",
        "destino": "fim_sem_interesse"
      },
      {
        "rotulo": "Não quero mais contato",
        "destino": "fim_optout"
      }
    ],
    "campo": "motivo_da_saida",
    "nota": "Grava como perdido, com o motivo. Só vira não contatar se a pessoa pedir para não ser mais procurada."
  },
  {
    "id": "fim_resolvido",
    "tipo": "fim",
    "variante": "ativacao",
    "texto": "Combinado. Qualquer dúvida no caminho, me chama no WhatsApp. Agradeço seu tempo, [nome]!",
    "saidas": [],
    "desfecho": "lig_interessado"
  },
  {
    "id": "ativ_obj_whatsapp",
    "tipo": "objecao",
    "variante": "ativacao",
    "texto": "Mando sim, com o passo a passo. E se travar em alguma parte, a gente resolve junto em 15 minutos: [opcao1] ou [opcao2]?",
    "saidas": [
      {
        "rotulo": "Escolheu um dos dois horários",
        "destino": "confirmar_whatsapp"
      },
      {
        "rotulo": "Quer outro dia",
        "destino": "agendar_outro_dia"
      },
      {
        "rotulo": "Só manda, eu faço",
        "destino": "fim_resolvido"
      }
    ]
  },
  {
    "id": "pedir_decisor",
    "tipo": "pergunta",
    "variante": "ambas",
    "texto": "Sem problema. Quem cuida das parcerias aí em [empresa]? Consigo falar com essa pessoa agora?",
    "saidas": [
      {
        "rotulo": "Vou te passar agora",
        "destino": "permissao"
      },
      {
        "rotulo": "Vou te passar agora",
        "destino": "ativ_retoma"
      },
      {
        "rotulo": "Agora essa pessoa não está",
        "destino": "anotar_decisor"
      },
      {
        "rotulo": "Não passo. Manda por e-mail",
        "destino": "anotar_email"
      },
      {
        "rotulo": "Não passo esse contato",
        "destino": "fim_agora_nao"
      }
    ],
    "nota": "Nunca \"com ele\" nem \"o nome dele\": quem decide pode ser qualquer pessoa."
  },
  {
    "id": "obj_nao_decide",
    "tipo": "objecao",
    "variante": "ambas",
    "texto": "Entendi! Quem seria a melhor pessoa pra falar sobre parcerias? Consegue me passar o contato, ou o melhor horário pra eu encontrar essa pessoa aí?",
    "saidas": [
      {
        "rotulo": "Passou o nome e o horário",
        "destino": "anotar_decisor"
      },
      {
        "rotulo": "Vai passar a ligação agora",
        "destino": "permissao"
      },
      {
        "rotulo": "Vai passar a ligação agora",
        "destino": "ativ_retoma"
      },
      {
        "rotulo": "Só por e-mail",
        "destino": "anotar_email"
      },
      {
        "rotulo": "Não passa o contato",
        "destino": "fim_agora_nao"
      }
    ]
  },
  {
    "id": "anotar_decisor",
    "tipo": "captura",
    "variante": "ambas",
    "texto": "Tudo bem. Qual é o nome de quem decide, e o melhor horário pra eu ligar?",
    "saidas": [
      {
        "rotulo": "Anota aí: nome e horário",
        "destino": "combinar_retorno"
      },
      {
        "rotulo": "Só por e-mail mesmo",
        "destino": "anotar_email"
      },
      {
        "rotulo": "Prefiro não passar",
        "destino": "fim_agora_nao"
      }
    ],
    "campo": "decisor",
    "nota": "Grava como retorno agendado, com o nome e o horário do decisor na nota."
  },
  {
    "id": "anotar_email",
    "tipo": "captura",
    "variante": "ambas",
    "texto": "Pode ser por e-mail, sim. Qual é o endereço certo? Eu mando assim que a gente desligar, com o meu nome e o site da Komune.",
    "saidas": [
      {
        "rotulo": "Anota aí, é esse",
        "destino": "combinar_retorno"
      },
      {
        "rotulo": "Não precisa mandar nada",
        "destino": "fim_agora_nao"
      },
      {
        "rotulo": "Melhor não me procurar mais",
        "destino": "fim_optout"
      }
    ],
    "campo": "email_do_decisor"
  },
  {
    "id": "combinar_retorno",
    "tipo": "captura",
    "variante": "ambas",
    "texto": "A gente fala em outra hora, então. Qual é o melhor dia e horário pra te procurar? Já anotei aqui, e te ligo sem falta.",
    "saidas": [
      {
        "rotulo": "Combinado",
        "destino": "fim_retorna"
      },
      {
        "rotulo": "Manda no WhatsApp que eu vejo",
        "destino": "obj_whatsapp"
      },
      {
        "rotulo": "Manda no WhatsApp que eu vejo",
        "destino": "ativ_obj_whatsapp"
      },
      {
        "rotulo": "Melhor não me ligar mais",
        "destino": "fim_optout"
      }
    ],
    "campo": "retorno_combinado",
    "nota": "Sem data combinada, a frase fica \"te ligo sem falta\" — por isso nenhuma preposição antes de dia e hora."
  },
  {
    "id": "agendar_outro_dia",
    "tipo": "captura",
    "variante": "ambas",
    "texto": "Sem problema. Qual dia e horário ficam bons pra você?",
    "saidas": [
      {
        "rotulo": "Marcado",
        "destino": "confirmar_whatsapp"
      },
      {
        "rotulo": "Prefere que eu ligue depois",
        "destino": "combinar_retorno"
      },
      {
        "rotulo": "Pensando melhor, não quero",
        "destino": "fim_sem_interesse"
      }
    ],
    "campo": "reuniao_combinada",
    "nota": "Anote o combinado. O dia, a hora e o formato você confirma na folha, ao gravar Reunião marcada."
  },
  {
    "id": "confirmar_whatsapp",
    "tipo": "captura",
    "variante": "ambas",
    "texto": "Fechado. Te mando a confirmação no WhatsApp: é nesse número aqui mesmo?",
    "saidas": [
      {
        "rotulo": "É esse",
        "destino": "fim_reuniao",
        "valor": "mesmo número da ligação"
      },
      {
        "rotulo": "É outro, anota aí",
        "destino": "fim_reuniao"
      },
      {
        "rotulo": "Não uso WhatsApp",
        "destino": "confirmar_por_email"
      }
    ],
    "campo": "whatsapp_de_trabalho"
  },
  {
    "id": "confirmar_por_email",
    "tipo": "captura",
    "variante": "ambas",
    "texto": "Mando por e-mail, então. Qual é o endereço certo? Eu te mando a confirmação com dia, hora e o formato, ainda hoje.",
    "saidas": [
      {
        "rotulo": "Anota aí, é esse",
        "destino": "fim_reuniao"
      },
      {
        "rotulo": "Deixa que eu te chamo",
        "destino": "fim_reuniao"
      }
    ],
    "campo": "email_de_confirmacao"
  },
  {
    "id": "obj_sem_tempo",
    "tipo": "objecao",
    "variante": "ambas",
    "texto": "Liguei em hora ruim, eu sei. É menos de um minuto: eu digo o que é e, se não servir, você me manda parar. Posso?",
    "saidas": [
      {
        "rotulo": "Pode, fala rápido",
        "destino": "forn_quem_somos"
      },
      {
        "rotulo": "Pode, fala rápido",
        "destino": "prod_quem_somos"
      },
      {
        "rotulo": "Pode, fala rápido",
        "destino": "ativ_retoma"
      },
      {
        "rotulo": "Me liga outra hora",
        "destino": "combinar_retorno"
      },
      {
        "rotulo": "Não me ligue mais",
        "destino": "fim_optout"
      }
    ]
  },
  {
    "id": "obj_golpe",
    "tipo": "objecao",
    "variante": "ambas",
    "texto": "Faz bem em perguntar. Meu nome é [eu], sou da Komune, aqui de Natal. O site é komune.app.br, e no Instagram é arroba komune ponto natal. Pode conferir agora que eu espero. E eu não peço CPF nem dado bancário por telefone. Posso seguir?",
    "saidas": [
      {
        "rotulo": "Agora entendi, pode falar",
        "destino": "forn_quem_somos"
      },
      {
        "rotulo": "Agora entendi, pode falar",
        "destino": "prod_quem_somos"
      },
      {
        "rotulo": "Agora entendi, pode falar",
        "destino": "ativ_retoma"
      },
      {
        "rotulo": "Confere e me liga outra hora",
        "destino": "combinar_retorno"
      },
      {
        "rotulo": "Não me ligue mais",
        "destino": "fim_optout"
      }
    ],
    "nota": "A prova é verificável na hora: nome de quem liga, komune.app.br e @komune.natal. Se insistir, pare de vender."
  },
  {
    "id": "obj_hostil",
    "tipo": "objecao",
    "variante": "ambas",
    "texto": "Você tem razão, e eu peço desculpa. Vou parar agora e registrar isso, pra ninguém te procurar de novo. Prefere que eu tire o contato de vocês de vez, ou que eu só não ligue mais por um tempo?",
    "saidas": [
      {
        "rotulo": "Tira de vez, não me ligue mais",
        "destino": "fim_optout"
      },
      {
        "rotulo": "Só não me liga tão cedo",
        "destino": "fim_agora_nao"
      },
      {
        "rotulo": "Desligou no meio",
        "destino": "fim_desligou"
      }
    ],
    "nota": "Prioridade absoluta (R08 §1, intenção 14): desculpa, para a cadência, e só. Não retome o pitch."
  },
  {
    "id": "obj_financeiro",
    "tipo": "objecao",
    "variante": "ambas",
    "texto": "Essa eu não vou responder de cabeça, pra não falar besteira. Prazo de repasse, cancelamento, nota fiscal e exigência de CNPJ eu confirmo com o financeiro e te mando por escrito hoje. Pode ser nesse mesmo número?",
    "saidas": [
      {
        "rotulo": "Pode, manda por escrito",
        "destino": "fim_material"
      },
      {
        "rotulo": "Pode, manda por escrito",
        "destino": "fim_resolvido"
      },
      {
        "rotulo": "Tá, pode continuar",
        "destino": "forn_valor"
      },
      {
        "rotulo": "Tá, pode continuar",
        "destino": "prod_valor"
      },
      {
        "rotulo": "Tá, pode continuar",
        "destino": "ativ_retoma"
      },
      {
        "rotulo": "Sem isso eu não sigo",
        "destino": "fim_agora_nao"
      }
    ],
    "nota": "Dúvida financeira sem resposta na FAQ: \"vou confirmar com o financeiro\" (CLAUDE.md)."
  },
  {
    "id": "fim_reuniao",
    "tipo": "fim",
    "variante": "ambas",
    "texto": "Fechado, nos falamos [dia] [hora]. Te mando a confirmação agora no WhatsApp. Agradeço seu tempo, [nome]!",
    "saidas": [],
    "desfecho": "lig_reuniao_marcada",
    "nota": "Depois de gravar, o recibo traz o botão da confirmação no WhatsApp, já preenchido."
  },
  {
    "id": "fim_material",
    "tipo": "fim",
    "variante": "captacao",
    "texto": "Mando agora mesmo. Dá uma olhada com calma, e qualquer coisa me chama por lá. Agradeço seu tempo, [nome]!",
    "saidas": [],
    "desfecho": "lig_interessado",
    "nota": "Material enviado. Mande o resumo pelo botão do recibo, e o retorno fica agendado."
  },
  {
    "id": "fim_agora_nao_material",
    "tipo": "fim",
    "variante": "captacao",
    "texto": "Mando agora. Agradeço seu tempo, e se fizer sentido lá na frente, a porta está aberta!",
    "saidas": [],
    "desfecho": "lig_agora_nao",
    "nota": "Sem interesse agora, com material enviado: vai para nutrição. Mande o resumo pelo botão do recibo."
  },
  {
    "id": "fim_retorna",
    "tipo": "fim",
    "variante": "ambas",
    "texto": "Então eu te ligo [dia] [hora]. Anotei aqui, e não vou te procurar antes disso. Valeu pelo tempo!",
    "saidas": [],
    "desfecho": "lig_atendeu_retorna",
    "nota": "Retorno agendado ou decisor mapeado. Com data na mão."
  },
  {
    "id": "fim_agora_nao",
    "tipo": "fim",
    "variante": "ambas",
    "texto": "Tranquilo. Não vou insistir agora — guardo o contato e só volto a falar se eu tiver alguma coisa nova pra contar. Valeu pelo tempo!",
    "saidas": [],
    "desfecho": "lig_agora_nao",
    "nota": "\"Agora não\" volta em 30 dias, em nutrição."
  },
  {
    "id": "fim_sem_interesse",
    "tipo": "fim",
    "variante": "ambas",
    "texto": "Entendi. Não vou insistir, então. Se um dia mudar, a porta fica aberta aqui. Valeu pelo tempo, e bom trabalho aí!",
    "saidas": [],
    "desfecho": "lig_sem_interesse",
    "nota": "Perdido, com 90 dias de espera: por isso o nó não promete \"nunca mais te ligo\". Quem pedir para não ser procurado vai para o opt-out."
  },
  {
    "id": "fim_optout",
    "tipo": "fim",
    "variante": "ambas",
    "texto": "Desculpa o incômodo. Não apago o contato: marco como bloqueado, e é isso que impede a Komune de ligar ou escrever de novo.",
    "saidas": [],
    "desfecho": "lig_sem_interesse",
    "nota": "Opt-out imediato (RF-CON-18). ANTES de tabular, marque a supressão: sem ela o desfecho sozinho é Perdido com 90 dias de espera, e a promessa desta frase vira mentira."
  },
  {
    "id": "fim_nao_e_evento",
    "tipo": "fim",
    "variante": "captacao",
    "texto": "Ah, então foi a minha lista que errou: trouxe vocês como quem trabalha com evento. Corrijo aqui agora. Desculpa, e valeu pelo tempo!",
    "saidas": [],
    "desfecho": "lig_sem_interesse",
    "nota": "O número está certo, a categoria da coleta é que estava errada. Tire a organização da base de evento antes de fechar."
  },
  {
    "id": "fim_engano",
    "tipo": "fim",
    "variante": "captacao",
    "texto": "Desculpa, então — foi engano meu. Não incomodo mais. [saudacao]!",
    "saidas": [],
    "resultadoTecnico": "numero_invalido",
    "nota": "Atendeu, mas não houve conversa comercial: fecha pelo eixo técnico."
  },
  {
    "id": "fim_desligou",
    "tipo": "fim",
    "variante": "ambas",
    "texto": "Caiu, ou desligaram no meio — não tem de quem se despedir. Fecha por aqui: o retorno fica marcado, e o caminho da conversa fica gravado.",
    "saidas": [],
    "resultadoTecnico": "queda_de_linha",
    "nota": "Fecha pelo eixo TÉCNICO: ninguém recusou nada, a linha caiu."
  }
]$roteiro$::jsonb, true)
on conflict (slug, versao) do update
  set nome = excluded.nome, arvore = excluded.arvore, is_published = true;


-- ===========================================================================
-- 5. As mensagens de depois da ligação
-- ===========================================================================
-- Sem meta_status: o worker-wa manda os três para a aprovação da Meta na próxima
-- sincronização, como fez com os outros.
insert into public.message_templates
  (template_code, name, channel, category, segment, kind, language, body, variables)
values
  ('GEN-LIG-CONFIRMA', 'Depois da ligação — confirmação da reunião', 'whatsapp', 'utility', 'GEN',
   'agendamento', 'pt_BR',
   'Oi, {{nome}}! Aqui é {{atendente}}, da Komune. Valeu pela ligação de agora há pouco! Fica confirmada nossa conversa no dia {{data}}, às {{hora}}. Formato: {{formato}}. Qualquer coisa, é só me chamar por aqui.',
   '["atendente", "data", "formato", "hora", "nome"]'::jsonb),
  ('GEN-LIG-RESUMO-FOR', 'Depois da ligação — resumo para fornecedor', 'whatsapp', 'marketing', 'GEN',
   'followup', 'pt_BR',
   'Oi, {{nome}}! Aqui é {{atendente}}, da Komune. Como combinamos na ligação, segue o resumo: a Komune é um app de Natal que conecta os fornecedores de eventos com quem está organizando aniversários, casamentos, formaturas e eventos de empresa. Estar na plataforma é de graça: não tem mensalidade nem adesão, e vocês só pagam quando fecham um serviço por lá. Quando quiser ver por dentro, é só me chamar. Para não receber mais mensagens, responda SAIR. Como usamos seus dados: komune.app.br/privacidade',
   '["atendente", "nome"]'::jsonb),
  ('GEN-LIG-RESUMO-PRO', 'Depois da ligação — resumo para produtor e cerimonialista', 'whatsapp', 'marketing', 'GEN',
   'followup', 'pt_BR',
   'Oi, {{nome}}! Aqui é {{atendente}}, da Komune. Como combinamos na ligação, segue o resumo: a Komune é um app de Natal para quem organiza evento. Você monta o evento e contrata os fornecedores da cidade num lugar só, com preço e avaliação na tela. Pra quem organiza não tem custo nenhum, e você ainda recebe 5% de tudo que contratar de fornecedor pela Komune, depois que o serviço é entregue. Quando quiser ver por dentro, é só me chamar. Para não receber mais mensagens, responda SAIR. Como usamos seus dados: komune.app.br/privacidade',
   '["atendente", "nome"]'::jsonb)
on conflict (template_code) do nothing;

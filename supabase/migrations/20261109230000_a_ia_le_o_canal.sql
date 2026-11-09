-- =====================================================================
-- A IA lê o canal de chegada: texto e até 3 fotos, só na Imova (06/11/2026)
--
-- Segunda metade de 20261109220000_o_canal_de_chegada. Quando nenhuma regra
-- forte decide (anúncio da Meta, link de portal), o job do canal pede à IA
-- (`imova-worker-ai`, Claude Haiku 5.5, prompt `canal-de-chegada@v1`) que leia
-- o começo da conversa e até 3 fotos da pessoa — a placa ou o banner da Imova,
-- o print de um anúncio — e diga o canal. Decisão do Rafael em 06/11/2026: a
-- IA pode ler a foto ("tudo ok").
--
-- O que esta migração acrescenta:
--   1. O PROPÓSITO `identificar_canal` nas quatro listas fechadas: o CHECK de
--      `ai_runs.purpose`, `app.ia_enfileirar`, `public.ia_adiar_trabalho` e
--      `app.ia_gasto_bloqueado_para`. ACRESCENTADO ao que está no banco, logo
--      depois de 'triar_candidato' (o molde da 20261109200000, dos relatórios
--      da Imova): reescrever a lista inteira apagaria o propósito que outra
--      frente tenha posto antes (09/11/2026, no porte para a main). O freio é
--      por exclusão: o propósito novo já nasce parando na linha de alerta (80%
--      do teto). Quem redefinir uma dessas funções depois tem de levar o nome
--      junto — o pgTAP 138 pega o esquecimento no banco da Imova.
--   2. O PEDIDO (`app.canal_enfileirar_ia`, no lugar do ponto de encaixe vazio
--      da migração anterior), com a `chave` DENTRO do payload: sem ela o
--      worker não acha a linha da dedup, e a primeira falha passageira iria
--      direto para a `ai_dlq` (o defeito que a fila de `analisar_conversa`
--      tem hoje; anotado no CHANGELOG, fora deste escopo).
--   3. A ENTRADA (`canal_entrada_da_ia`): as mensagens da janela, quem disse,
--      o tipo, e quais fotos o worker pode baixar do balde. O worker troca os
--      ids por m1/f1 e pseudonimiza o texto antes de ir ao modelo.
--   4. A GRAVAÇÃO (`canal_gravar_da_ia`), que confere cada prova contra as
--      mensagens da chegada e respeita a ordem: gente > regra forte > IA >
--      regra fraca. A IA nunca escreve o que gente marcou.
--
-- O WHATSAPP NÃO MUDA: nada aqui grava mensagem nem enfileira envio.
-- SÓ DA IMOVA: no banco da KOMUNE nada é criado e as listas não mudam.
-- =====================================================================

do $canal_ia$
declare
  v_def  text;
  v_novo text;
  v_alvo regprocedure;
begin
  if (select i.empresa from app.identidade i) = 'komune' then
    raise notice 'A IA do canal de chegada é só da Imova: no banco da KOMUNE nada foi criado.';
    return;
  end if;
  execute $ddl$

-- (1. O propósito novo nas quatro listas: no fim, fora deste bloco, ACRESCENTADO
-- ao que já está no banco.)

-- =====================================================================
-- 2. O pedido à IA
-- =====================================================================
create or replace function app.canal_enfileirar_ia(p_chegada_id uuid, p_lida_ate timestamptz, p_mensagens int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conv  uuid;
  v_chave text;
begin
  select c.conversation_id into v_conv from public.chegadas c where c.id = p_chegada_id;
  if v_conv is null then
    return jsonb_build_object('enfileirado', false, 'motivo', 'nao_achada');
  end if;
  -- Muda quando a pessoa escreve de novo: é o que permite a releitura, e o que
  -- faz a dedup recusar o mesmo pedido duas vezes.
  v_chave := p_chegada_id::text || ':' || coalesce(p_mensagens, 0) || '@'
             || to_char(p_lida_ate at time zone 'UTC', 'YYYYMMDDHH24MISSUS');
  return app.ia_enfileirar('identificar_canal',
                           jsonb_build_object('chegada_id', p_chegada_id,
                                              'conversation_id', v_conv,
                                              'chave', v_chave),
                           v_chave);
end $$;
comment on function app.canal_enfileirar_ia(uuid, timestamptz, int) is
  'Põe a leitura do canal de uma chegada na fila de IA (identificar_canal), com a chave dentro do payload. Recusa do freio volta como {enfileirado:false, adiado:true}, nunca como exceção.';
revoke all on function app.canal_enfileirar_ia(uuid, timestamptz, int) from public, anon, authenticated;

-- =====================================================================
-- 3. A entrada da IA
-- =====================================================================
create or replace function app.canal_entrada_da_ia(p_chegada_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cfg      jsonb := app.canal_de_chegada_config();
  ch         public.chegadas%rowtype;
  cv         record;
  v_fim      timestamptz;
  v_foto_ate timestamptz;
  v_pular    text;
  v_msgs     jsonb;
  v_lida     timestamptz;
  v_indisp   int;
begin
  select * into ch from public.chegadas c where c.id = p_chegada_id;
  if not found then
    return jsonb_build_object('chegada_id', p_chegada_id, 'pular', 'nao_achada', 'mensagens', '[]'::jsonb,
                              'fotos_indisponiveis', 0, 'fotos_max', 0, 'foto_bytes_max', 0);
  end if;
  select c.organization_id, c.contact_id, c.peer_nome, c.peer_phone_e164, c.bloqueada_em into cv
    from public.conversations c where c.id = ch.conversation_id;
  v_fim := ch.inicio_em + make_interval(hours => coalesce((v_cfg ->> 'reavaliar_horas')::int, 24));
  v_foto_ate := ch.inicio_em + make_interval(mins => coalesce((v_cfg ->> 'foto_ate_min')::int, 30));

  v_pular := case
    when not coalesce((v_cfg ->> 'ia')::boolean, false) then 'desligada'
    when ch.canal_marcado is not null then 'marcada_por_gente'
    when ch.regra_forte then 'regra_forte'
    -- Fechada só se lê para preencher um Não identificado (a dívida do
    -- orçamento paga depois das 24 h).
    when ch.situacao = 'fechada' and ch.canal_automatico is distinct from 'nao_identificado' then 'fechada'
    when ch.leituras_da_ia >= coalesce((v_cfg ->> 'leituras_ia_max')::int, 2) then 'teto_de_leituras'
    when cv.bloqueada_em is not null
         or app.is_suppressed(cv.peer_phone_e164, null, null)
         or coalesce(app.is_suppressed_target(cv.organization_id, cv.contact_id), false) then 'suprimido'
    else null end;

  with base as (
    select m.id, m.created_at, m.direction, m.author_kind, m.type, m.tipo_na_meta,
           m.body, m.transcript, m.media_path, m.media_mime
      from public.messages m
     where m.conversation_id = ch.conversation_id
       and m.type not in ('system'::app.msg_type, 'reaction'::app.msg_type)
       and m.apagada_em is null
       and m.created_at >= ch.inicio_em
       and m.created_at < v_fim
  ), numeradas as (
    select b.*,
           case when b.direction = 'in'::app.msg_direction
                then row_number() over (partition by b.direction order by b.created_at, b.id) end as n_cliente
      from base b
  ), escolhidas as (
    -- Até 12 da pessoa, com as do time no meio, no máximo 20.
    select * from numeradas n
     where n.n_cliente is null or n.n_cliente <= 12
     order by n.created_at, n.id
     limit 20
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', e.id,
           'de', case when e.direction = 'in'::app.msg_direction then 'cliente'
                      when e.author_kind = 'human' then 'equipe'
                      else 'robo' end,
           'quando', to_char(e.created_at at time zone 'America/Fortaleza', 'DD/MM HH24:MI'),
           'created_at', e.created_at,
           'tipo', case
                     when e.type = 'image'::app.msg_type and coalesce(e.tipo_na_meta, '') = 'sticker' then 'outro'
                     when e.type = 'image'::app.msg_type then 'foto'
                     when e.type = 'audio'::app.msg_type then 'audio'
                     when e.type = 'video'::app.msg_type then 'video'
                     when e.type = 'document'::app.msg_type then 'documento'
                     when e.body is not null then 'texto'
                     else 'outro' end,
           'texto', left(coalesce(e.body, e.transcript), 500),
           'media_path', e.media_path,
           'media_mime', e.media_mime,
           'foto_elegivel', (e.direction = 'in'::app.msg_direction
                             and e.type = 'image'::app.msg_type
                             and coalesce(e.tipo_na_meta, '') <> 'sticker'
                             and e.media_path is not null
                             and e.created_at < v_foto_ate))
           order by e.created_at, e.id), '[]'::jsonb),
         max(e.created_at) filter (where e.direction = 'in'::app.msg_direction)
    into v_msgs, v_lida
    from escolhidas e;

  select count(*)::int into v_indisp
    from public.messages m
   where m.conversation_id = ch.conversation_id
     and m.direction = 'in'::app.msg_direction
     and m.type = 'image'::app.msg_type
     and coalesce(m.tipo_na_meta, '') <> 'sticker'
     and m.created_at >= ch.inicio_em and m.created_at < v_foto_ate
     and m.media_path is null;

  return jsonb_build_object(
    'chegada_id', ch.id,
    'conversation_id', ch.conversation_id,
    'organization_id', cv.organization_id,
    'contact_id', cv.contact_id,
    'peer_nome', cv.peer_nome,
    -- Só para o worker APAGAR este número de qualquer texto antes de ir ao
    -- modelo (a passada da pseudonimização que não falha); nunca vai ao modelo.
    'peer_telefone', cv.peer_phone_e164,
    'inicio_em', ch.inicio_em,
    'agora', now(),
    'pular', v_pular,
    'mensagens', v_msgs,
    'fotos_indisponiveis', coalesce(v_indisp, 0),
    'fotos_max', coalesce((v_cfg ->> 'fotos_max')::int, 3),
    'foto_bytes_max', coalesce((v_cfg ->> 'foto_bytes_max')::int, 5242880),
    'lida_ate', coalesce(v_lida, ch.inicio_em));
end $$;
comment on function app.canal_entrada_da_ia(uuid) is
  'O que canal-de-chegada@v1 lê: as mensagens da janela da chegada (até 12 da pessoa, 20 ao todo, 500 letras cada), quem disse, o tipo e quais fotos podem ser baixadas do balde (as da pessoa nos primeiros 30 minutos, sem figurinha). "pular" diz por que não ler (desligada, marcada por gente, regra forte, fechada, teto, suprimido).';
revoke all on function app.canal_entrada_da_ia(uuid) from public, anon, authenticated;

create or replace function public.canal_entrada_da_ia(p_chegada_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select app.canal_entrada_da_ia(p_chegada_id)
$$;
comment on function public.canal_entrada_da_ia(uuid) is
  'Porta do worker de IA (service_role) para app.canal_entrada_da_ia.';
revoke all on function public.canal_entrada_da_ia(uuid) from public, anon, authenticated;
grant execute on function public.canal_entrada_da_ia(uuid) to service_role;
grant execute on function app.canal_entrada_da_ia(uuid) to service_role;

-- =====================================================================
-- 4. A gravação da IA
-- =====================================================================
create or replace function app.canal_gravar_da_ia(p_chegada_id uuid, p_resultado jsonb, p_lida_ate timestamptz,
                                                 p_ai_run_id bigint default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cfg      jsonb := app.canal_de_chegada_config();
  ch         public.chegadas%rowtype;
  v_fim      timestamptz;
  v_canal    text := p_resultado ->> 'canal';
  v_sub      text := p_resultado ->> 'subcanal';
  v_conf     numeric;
  v_motivo   text := left(nullif(btrim(coalesce(p_resultado ->> 'motivo', '')), ''), 300);
  v_evid     jsonb;
  v_foto     jsonb;
  v_minima   numeric := coalesce((v_cfg ->> 'ia_confianca_minima')::numeric, 0.6);
  v_sugestao jsonb;
begin
  select * into ch from public.chegadas c where c.id = p_chegada_id for update;
  if not found then
    return jsonb_build_object('gravado', false, 'motivo', 'nao_achada');
  end if;
  v_fim := ch.inicio_em + make_interval(hours => coalesce((v_cfg ->> 'reavaliar_horas')::int, 24));

  begin
    v_conf := greatest(least((p_resultado ->> 'confianca')::numeric, 1), 0);
  exception when others then
    v_conf := 0;
  end;
  if v_canal is null or v_canal not in ('placa', 'anuncios', 'redes_sociais', 'outros', 'nao_identificado')
     or not app.canal_subcanal_valido(v_canal, v_sub) then
    return jsonb_build_object('gravado', false, 'motivo', 'resultado_invalido');
  end if;

  -- Cada prova tem de ser uma mensagem DESTA chegada.
  select coalesce(jsonb_agg(jsonb_build_object('message_id', m.id,
                                               'tipo', e ->> 'tipo',
                                               'trecho', left(coalesce(e ->> 'trecho', ''), 160))
                            order by m.created_at), '[]'::jsonb)
    into v_evid
    from jsonb_array_elements(case when jsonb_typeof(p_resultado -> 'evidencias') = 'array'
                                   then p_resultado -> 'evidencias' else '[]'::jsonb end) e
    join public.messages m
      on m.id = case when (e ->> 'message_id') ~ '^[0-9a-f-]{36}$' then (e ->> 'message_id')::uuid end
     and m.conversation_id = ch.conversation_id
     and m.created_at >= ch.inicio_em and m.created_at < v_fim
   where (e ->> 'tipo') in ('texto', 'foto');

  -- A foto descrita tem de ser uma foto da pessoa nesta chegada.
  if jsonb_typeof(p_resultado -> 'foto') = 'object'
     and exists (select 1 from public.messages m
                  where m.id = case when (p_resultado -> 'foto' ->> 'message_id') ~ '^[0-9a-f-]{36}$'
                                    then (p_resultado -> 'foto' ->> 'message_id')::uuid end
                    and m.conversation_id = ch.conversation_id
                    and m.direction = 'in'::app.msg_direction
                    and m.type = 'image'::app.msg_type) then
    v_foto := jsonb_build_object(
      'message_id', p_resultado -> 'foto' ->> 'message_id',
      'peca', case when p_resultado -> 'foto' ->> 'peca' in ('placa', 'banner', 'print_de_anuncio',
                                                            'print_de_rede_social', 'imovel', 'outra')
                   then p_resultado -> 'foto' ->> 'peca' else 'outra' end,
      'marca', case when p_resultado -> 'foto' ->> 'marca' in ('imova', 'outra_imobiliaria', 'sem_marca', 'ilegivel')
                    then p_resultado -> 'foto' ->> 'marca' else 'ilegivel' end,
      'descricao', left(coalesce(p_resultado -> 'foto' ->> 'descricao', ''), 160),
      'codigo_do_imovel', case when (p_resultado -> 'foto' ->> 'codigo_do_imovel') ~* '^[A-Z0-9_ -]{2,30}$'
                               then upper(p_resultado -> 'foto' ->> 'codigo_do_imovel') end);
  end if;

  -- Sem prova não há canal.
  if v_canal <> 'nao_identificado' and jsonb_array_length(v_evid) = 0 then
    v_motivo := coalesce(v_motivo, '') || case when v_motivo is null then '' else ' ' end
                || '(sem prova nas mensagens)';
    v_canal := 'nao_identificado';
    v_sub := 'desconhecido';
  end if;

  v_sugestao := jsonb_build_object('canal', v_canal, 'subcanal', v_sub, 'confianca', v_conf,
                                   'motivo', v_motivo, 'em', now());

  update public.chegadas c
     set leituras_da_ia = c.leituras_da_ia + 1,
         ia_lida_ate    = greatest(coalesce(c.ia_lida_ate, p_lida_ate), p_lida_ate),
         ia_adiada      = false,
         sugestao_da_ia = v_sugestao,
         foto           = coalesce(v_foto, c.foto),
         ai_run_id      = coalesce(p_ai_run_id, c.ai_run_id)
   where c.id = ch.id;

  -- A ordem: gente > regra forte > IA > regra fraca.
  if ch.canal_marcado is not null then
    return jsonb_build_object('gravado', false, 'motivo', 'marcada_por_gente', 'canal', ch.canal);
  end if;
  if ch.regra_forte then
    return jsonb_build_object('gravado', false, 'motivo', 'regra_forte', 'canal', ch.canal);
  end if;
  if ch.situacao = 'fechada' and ch.canal_automatico is distinct from 'nao_identificado' then
    return jsonb_build_object('gravado', false, 'motivo', 'fechada', 'canal', ch.canal);
  end if;

  if v_canal = 'nao_identificado' or v_conf < v_minima then
    -- A IA não achou (ou achou sem certeza): a regra fraca, se houver, fica.
    if ch.canal_automatico is not null and ch.canal_automatico <> 'nao_identificado'
       and ch.decidido_por = 'regra' then
      return jsonb_build_object('gravado', false, 'motivo', 'regra_fraca_mantida', 'canal', ch.canal);
    end if;
    perform app.chegada_definir(ch.id, 'nao_identificado', 'desconhecido', v_conf, 'ia', null, false, v_evid,
                                case when v_canal <> 'nao_identificado'
                                     then 'A IA achou que pode ser ' || app.canal_rotulo(v_canal)
                                          || ', sem certeza' || coalesce(': ' || v_motivo, '')
                                     else coalesce(v_motivo, 'A IA não achou sinal do canal no começo da conversa') end);
    return jsonb_build_object('gravado', true, 'motivo', null, 'canal', 'nao_identificado');
  end if;

  perform app.chegada_definir(ch.id, v_canal, v_sub, v_conf, 'ia', null, false, v_evid,
                              coalesce(v_motivo, 'A IA leu o começo da conversa'));
  return jsonb_build_object('gravado', true, 'motivo', null, 'canal', v_canal);
end $$;
comment on function app.canal_gravar_da_ia(uuid, jsonb, timestamptz, bigint) is
  'Grava a leitura da IA numa chegada, conferindo cada prova contra as mensagens dela (sem prova = Não identificado) e respeitando a ordem gente > regra forte > IA > regra fraca. A resposta fica sempre em sugestao_da_ia; a foto descrita, em foto.';
revoke all on function app.canal_gravar_da_ia(uuid, jsonb, timestamptz, bigint) from public, anon, authenticated;

create or replace function public.canal_gravar_da_ia(p_chegada_id uuid, p_resultado jsonb, p_lida_ate timestamptz,
                                                    p_ai_run_id bigint default null)
returns jsonb language sql security invoker set search_path = '' as $$
  select app.canal_gravar_da_ia(p_chegada_id, p_resultado, p_lida_ate, p_ai_run_id)
$$;
comment on function public.canal_gravar_da_ia(uuid, jsonb, timestamptz, bigint) is
  'Porta do worker de IA (service_role) para app.canal_gravar_da_ia.';
revoke all on function public.canal_gravar_da_ia(uuid, jsonb, timestamptz, bigint) from public, anon, authenticated;
grant execute on function public.canal_gravar_da_ia(uuid, jsonb, timestamptz, bigint) to service_role;
grant execute on function app.canal_gravar_da_ia(uuid, jsonb, timestamptz, bigint) to service_role;

  $ddl$;

  -- ===================================================================
  -- 1. O propósito `identificar_canal`, ACRESCENTADO às listas do banco
  -- ===================================================================
  -- A lista que está no banco ganha o nosso logo depois de 'triar_candidato'.
  -- Se a âncora não estiver lá exatamente uma vez, a migração para.
  select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c
   where c.conname = 'ai_runs_purpose_check' and c.conrelid = 'public.ai_runs'::regclass;
  if v_def is null then
    raise exception 'ai_runs_purpose_check não existe';
  end if;
  if strpos(v_def, '''identificar_canal''') = 0 then
    if (length(v_def) - length(replace(v_def, '''triar_candidato''::text', ''))) / length('''triar_candidato''::text') <> 1 then
      raise exception 'ai_runs_purpose_check: a âncora triar_candidato não aparece uma vez só';
    end if;
    v_novo := replace(v_def, '''triar_candidato''::text', '''triar_candidato''::text, ''identificar_canal''::text');
    alter table public.ai_runs drop constraint ai_runs_purpose_check;
    execute 'alter table public.ai_runs add constraint ai_runs_purpose_check ' || v_novo;
  end if;

  foreach v_alvo in array array[
      'app.ia_enfileirar(text,jsonb,text)'::regprocedure,
      'public.ia_adiar_trabalho(text,jsonb,text,text)'::regprocedure,
      'app.ia_gasto_bloqueado_para()'::regprocedure] loop
    v_def := pg_get_functiondef(v_alvo);
    if strpos(v_def, '''identificar_canal''') = 0 then
      if (length(v_def) - length(replace(v_def, '''triar_candidato''', ''))) / length('''triar_candidato''') <> 1 then
        raise exception '%: a âncora triar_candidato não aparece uma vez só', v_alvo;
      end if;
      execute replace(v_def, '''triar_candidato''', '''triar_candidato'', ''identificar_canal''');
    end if;
  end loop;
end $canal_ia$;

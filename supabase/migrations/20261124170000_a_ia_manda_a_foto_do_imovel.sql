-- =====================================================================
-- A IA que atende manda a foto do imóvel para confirmar (Imova, 24/11/2026)
--
-- Pedido do usuário, com o print da conversa em que a IA achou o terreno da
-- Etelvino Cunha pela Avenida Gustavo Neves: "gostaria que a IA tivesse o
-- poder de enviar foto ao cliente, nesse caso ele poderia na primeira
-- mensagem enviar uma mensagem mais humanizada e logo na mensagem seguinte
-- enviar uma imagem do terreno que a IA captou pelas informações, e
-- perguntar ao cliente se é esse terreno/imóvel que ele estava se referindo.
-- O cliente confirmando o imóvel/terreno a IA segue com o atendimento."
--
-- O CAMINHO: a IA (`atendente-imova@v8`) devolve o texto e, quando quer
-- confirmar o imóvel, o código dele e a legenda. O worker manda o texto pela
-- porta de sempre (`ia_atendente_responder`), copia a foto de capa do anúncio
-- do balde `anuncios` para o balde `mensagens` (`ia/<conversa>/...`) e chama
-- `ia_atendente_mostrar_foto`, que põe a foto na fila logo depois do texto.
-- O worker-wa manda como manda qualquer foto do CRM.
--
-- O QUE MUDA (só na Imova):
--   * `public.ia_atendente_capa_do_imovel(codigo)`: a foto de capa do anúncio
--     (a primeira da ordem do anúncio), para o worker copiar.
--   * `public.ia_atendente_mostrar_foto(...)`: a única porta da foto da IA.
--     As travas são as do texto (`app.ia_atendente_dizer`): a IA atende a
--     conversa, não chegou mensagem nova do cliente, teto por hora; mais as
--     da foto: o imóvel existe, o arquivo está no balde `mensagens` sob `ia/`,
--     uma foto por mensagem do cliente, e o texto daquela resposta já saiu
--     (a foto vem sempre depois dele). Registra em `ia_respostas` (com o
--     código em `detalhes.foto`), que é a prova que a porteira confere.
--   * `public.ia_entrada_do_atendente`: a foto que a IA mandou aparece na
--     conversa que ela lê como "[foto do anúncio TE0006 que você mandou]" e a
--     legenda, para ela entender o "é esse sim" do cliente.
--
-- Na KOMUNE não faz nada.
--
-- COMO DESFAZER: `drop function public.ia_atendente_mostrar_foto(uuid, uuid,
-- text, text, text, jsonb, bigint, text)` e `public.ia_atendente_capa_do_imovel
-- (text)`; reaplicar `public.ia_entrada_do_atendente` trocando o ramo novo da
-- foto da IA pelo de antes. O worker volta à v7 sozinho se a porta não existir.
-- =====================================================================

do $imova$
declare
  v_def    text;
  v_antes  text := E'               when m.type = ''image''::app.msg_type then\n'
                || E'                 ''[foto]'' || coalesce('' '' || nullif(btrim(m.body), ''''), '''')';
  v_depois text := E'               -- A foto que a IA mandou para confirmar o imóvel (24/11/2026).\n'
                || E'               when m.type = ''image''::app.msg_type and m.author_kind = ''bot_ai'' then\n'
                || E'                 ''[foto do anúncio '' || coalesce((select r.detalhes ->> ''foto'' from public.ia_respostas r\n'
                || E'                                                     where r.message_id = m.id), ''do imóvel'')\n'
                || E'                 || '' que você mandou]''\n'
                || E'                 || coalesce('' '' || nullif(btrim(coalesce(app.sem_assinatura(m.body), m.body)), ''''), '''')\n'
                || E'               when m.type = ''image''::app.msg_type then\n'
                || E'                 ''[foto]'' || coalesce('' '' || nullif(btrim(m.body), ''''), '''')';
  v_vezes  int;
begin
  if (select i.empresa from app.identidade i) = 'komune' then
    raise notice 'A IA que atende é da Imova: nada muda no banco da KOMUNE.';
    return;
  end if;

  -- -------------------------------------------------------------------
  -- 1. A foto de capa do anúncio
  -- -------------------------------------------------------------------
  execute $ddl$
create or replace function public.ia_atendente_capa_do_imovel(p_codigo text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('anuncio_id', a.id, 'codigo', a.codigo, 'caminho', f.caminho)
    from public.anuncios a
    join public.anuncio_fotos f on f.anuncio_id = a.id
   where a.id = app.agenda_anuncio_do_codigo(p_codigo)
   order by f.posicao, f.criada_em, f.id
   limit 1
$$;
comment on function public.ia_atendente_capa_do_imovel(text) is
  'Porta do worker de IA (Imova, 24/11/2026): a foto de capa (a primeira da ordem) do anúncio daquele código, no balde anuncios, para a IA mandar ao cliente ao confirmar o imóvel. Nulo: código desconhecido ou anúncio sem foto.';
revoke all on function public.ia_atendente_capa_do_imovel(text) from public, anon, authenticated;
grant execute on function public.ia_atendente_capa_do_imovel(text) to service_role;
  $ddl$;

  -- -------------------------------------------------------------------
  -- 2. A porta da foto
  -- -------------------------------------------------------------------
  execute $ddl$
create or replace function public.ia_atendente_mostrar_foto(
  p_conversation_id uuid, p_em_resposta_a uuid, p_imovel_codigo text,
  p_media_path text, p_legenda text,
  p_detalhes jsonb default '{}'::jsonb, p_ai_run_id bigint default null,
  p_prompt_version text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_cfg     jsonb := app.ia_atendente_config();
  v_legenda text := btrim(coalesce(p_legenda, ''));
  v_assin   text := nullif(btrim(coalesce(v_cfg ->> 'assinatura', '')), '');
  v_teto    int := greatest(coalesce((v_cfg ->> 'teto_por_hora')::int, 20), 1);
  v_anuncio uuid;
  v_codigo  text;
  v_corpo   text;
  v_ultima  uuid;
  v_hora    int;
  v_resp    uuid;
  v_msg     uuid;
begin
  perform 1 from public.conversations where id = p_conversation_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'conversa_nao_existe');
  end if;
  if not app.ia_atende(p_conversation_id) then
    return jsonb_build_object('ok', false, 'motivo', 'ia_nao_atende');
  end if;
  if v_legenda = '' then
    return jsonb_build_object('ok', false, 'motivo', 'legenda_vazia');
  end if;
  if char_length(v_legenda) > 300 then
    return jsonb_build_object('ok', false, 'motivo', 'legenda_longa_demais');
  end if;

  v_anuncio := app.agenda_anuncio_do_codigo(p_imovel_codigo);
  if v_anuncio is null then
    return jsonb_build_object('ok', false, 'motivo', 'imovel_desconhecido');
  end if;
  select a.codigo into v_codigo from public.anuncios a where a.id = v_anuncio;

  -- O arquivo é a cópia que o worker pôs no balde das mensagens, sob `ia/`.
  if p_media_path is null or p_media_path not like 'ia/%' or not exists (
       select 1 from storage.objects o where o.bucket_id = 'mensagens' and o.name = p_media_path) then
    return jsonb_build_object('ok', false, 'motivo', 'arquivo_nao_existe');
  end if;

  -- Chegou mensagem do cliente depois da que ela leu? A foto está velha.
  select m.id into v_ultima from public.messages m
   where m.conversation_id = p_conversation_id
     and m.direction = 'in'::app.msg_direction
     and m.type not in ('reaction'::app.msg_type, 'system'::app.msg_type)
   order by m.created_at desc, m.id desc
   limit 1;
  if p_em_resposta_a is null or v_ultima is distinct from p_em_resposta_a then
    return jsonb_build_object('ok', false, 'motivo', 'chegou_mensagem_nova');
  end if;

  -- A foto vem depois do texto daquela resposta, e uma vez só.
  if not exists (select 1 from public.ia_respostas r
                  where r.em_resposta_a = p_em_resposta_a and r.message_id is not null
                    and not (r.detalhes ? 'foto')) then
    return jsonb_build_object('ok', false, 'motivo', 'sem_texto_antes');
  end if;
  if exists (select 1 from public.ia_respostas r
              where r.em_resposta_a = p_em_resposta_a and r.message_id is not null
                and r.detalhes ? 'foto') then
    return jsonb_build_object('ok', false, 'motivo', 'foto_ja_mandada');
  end if;

  select count(*) into v_hora from public.ia_respostas r
   where r.conversation_id = p_conversation_id and r.message_id is not null
     and r.criada_em > now() - interval '1 hour';
  if v_hora >= v_teto then
    return jsonb_build_object('ok', false, 'motivo', 'teto_por_hora');
  end if;

  v_corpo := case when v_assin is null then v_legenda
                  else '*' || v_assin || ':*' || E'\n' || v_legenda end;

  begin
    insert into public.ia_respostas (conversation_id, em_resposta_a, corpo, acao, detalhes,
                                     ai_run_id, prompt_version)
    values (p_conversation_id, p_em_resposta_a, v_corpo, 'respondeu',
            coalesce(p_detalhes, '{}'::jsonb) || jsonb_build_object('foto', v_codigo, 'anuncio_id', v_anuncio),
            p_ai_run_id, p_prompt_version)
    returning id into v_resp;

    insert into public.messages (conversation_id, direction, type, status, body,
                                 media_path, media_mime, author_kind, origin)
    values (p_conversation_id, 'out'::app.msg_direction, 'image'::app.msg_type,
            'queued'::app.msg_status, v_corpo, p_media_path, 'image/jpeg', 'bot_ai', 'crm')
    returning id into v_msg;

    update public.ia_respostas set message_id = v_msg where id = v_resp;
  exception when others then
    -- A porteira recusou (contato suprimido, janela fechada, teto...): nada
    -- sai, e fica o registro do porquê.
    insert into public.ia_respostas (conversation_id, em_resposta_a, corpo, acao, detalhes,
                                     ai_run_id, prompt_version)
    values (p_conversation_id, p_em_resposta_a, left(v_corpo, 1500), 'nao_respondeu',
            coalesce(p_detalhes, '{}'::jsonb)
              || jsonb_build_object('quis', 'foto', 'foto', v_codigo, 'motivo', 'porteira',
                                    'erro', left(sqlerrm, 300)),
            p_ai_run_id, p_prompt_version);
    return jsonb_build_object('ok', false, 'motivo', 'porteira', 'erro', sqlerrm);
  end;

  return jsonb_build_object('ok', true, 'message_id', v_msg, 'resposta_id', v_resp, 'codigo', v_codigo);
end $$;
comment on function public.ia_atendente_mostrar_foto(uuid, uuid, text, text, text, jsonb, bigint, text) is
  'Porta do worker de IA (Imova, 24/11/2026): a foto do imóvel que a IA manda para o cliente confirmar, logo depois do texto da mesma resposta. Confere o que o texto confere (a IA atende, não chegou mensagem nova, teto por hora) e mais: o imóvel existe, o arquivo está no balde mensagens sob ia/, o texto já saiu e é a primeira foto daquela resposta. Registra em ia_respostas (detalhes.foto = código) e põe a foto assinada na fila.';
revoke all on function public.ia_atendente_mostrar_foto(uuid, uuid, text, text, text, jsonb, bigint, text) from public, anon, authenticated;
grant execute on function public.ia_atendente_mostrar_foto(uuid, uuid, text, text, text, jsonb, bigint, text) to service_role;
  $ddl$;

  -- -------------------------------------------------------------------
  -- 3. A IA vê a foto que mandou
  -- -------------------------------------------------------------------
  if to_regprocedure('public.ia_entrada_do_atendente(uuid)') is null then
    raise notice 'ia_entrada_do_atendente não existe neste banco: a foto da IA aparece como [foto].';
    return;
  end if;
  v_def := pg_get_functiondef('public.ia_entrada_do_atendente(uuid)'::regprocedure);
  if position('[foto do anúncio ' in v_def) > 0 then
    raise notice 'ia_entrada_do_atendente já mostra a foto da IA: nada a trocar.';
    return;
  end if;
  v_vezes := (char_length(v_def) - char_length(replace(v_def, v_antes, ''))) / char_length(v_antes);
  if v_vezes <> 1 then
    raise exception 'ia_entrada_do_atendente não tem o ramo da foto exatamente uma vez (achei %): nada foi trocado.', v_vezes;
  end if;
  execute replace(v_def, v_antes, v_depois);
end $imova$;

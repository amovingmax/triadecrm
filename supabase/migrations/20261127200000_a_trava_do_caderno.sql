-- =====================================================================
-- A trava do caderno: nota que faria a IA parar não entra (Imova, 27/11/2026)
-- =====================================================================
-- Pedido do dono (item 23 da entrevista de 24/11, "o caderno testa a nota ao
-- salvar"), com a ordem de 27/11: "É extremamente importante que a IA não pare
-- de atender os clientes."
--
-- O caderno vai em toda resposta da IA. Um trecho sem letra com 10 ou mais
-- algarismos (a FICHA 4 com "1.338,99, 2.021", em 19/11), um e-mail ou um @
-- parecem dado pessoal para a conferência da chamada, e a IA parou com todos
-- os clientes por 40 minutos. O worker passou a tirar esse trecho da leitura e
-- responder mesmo assim (`apps/workers/src/ia/blindagem.ts`); aqui o problema
-- é barrado na entrada:
--   - `app.ia_caderno_problema`: o que travaria (telefone, contato) e o trecho;
--   - `app.ia_caderno_sem_problema`: o mesmo texto com o trecho trocado por
--     "[número tirado]" / "[contato tirado]";
--   - "Ensinar" e o lápis (`public.ia_caderno_escrever`) recusam, dizendo o
--     trecho; "Corrigir" (`public.ia_resposta_avaliar`) recusa o que a pessoa
--     escreveu e limpa o que veio do cliente e da IA; o treino
--     (`public.ia_atendente_anotar`) limpa;
--   - o gatilho `ia_caderno_sem_trava` recusa qualquer outro caminho (rede de
--     segurança: nenhuma nota com o problema entra nem é editada para tê-lo).
-- As notas ativas em 27/11 passaram todas (36, conferidas antes).
--
-- Na KOMUNE não faz nada (o caderno é da Imova).
--
-- COMO DESFAZER: drop do gatilho `ia_caderno_sem_trava` e das funções
-- `app.ia_caderno_problema`, `app.ia_caderno_sem_problema` e
-- `app.ia_caderno_sem_trava`; reaplicar `public.ia_caderno_escrever`,
-- `public.ia_resposta_avaliar` e `public.ia_atendente_anotar` como estão em
-- 20261106170000.
-- =====================================================================

do $imova$
begin
  if (select i.empresa from app.identidade i) = 'komune' then
    raise notice 'A trava do caderno é da Imova: nada muda no banco da KOMUNE.';
    return;
  end if;

  execute $ddl$
-- O que faria a IA parar: telefone (10 ou mais algarismos sem letra no meio) ou
-- contato (e-mail, @, Instagram). Devolve { motivo, trecho } ou nulo. A mesma regra
-- está na tela (components/ia-que-atende/trava-do-caderno.ts).
create or replace function app.ia_caderno_problema(p_texto text) returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v       text := coalesce(p_texto, '');
  v_m     text[];
  v_parte text;
begin
  v_m := regexp_match(v, '[^[:space:]@]*@[^[:space:]@]*');
  if v_m is not null then
    return jsonb_build_object('motivo', 'contato', 'trecho', left(v_m[1], 60));
  end if;
  v_m := regexp_match(v, '((www\.)?instagram\.com/[^[:space:]]*)', 'i');
  if v_m is not null then
    return jsonb_build_object('motivo', 'contato', 'trecho', left(v_m[1], 60));
  end if;
  foreach v_parte in array regexp_split_to_array(v, '[A-Za-zÀ-ÖØ-öø-ÿ]+') loop
    if char_length(regexp_replace(v_parte, '[^0-9]', '', 'g')) >= 10 then
      return jsonb_build_object('motivo', 'telefone',
                                'trecho', left(btrim(v_parte, E' \t\n\r.,;:()[]-/'), 60));
    end if;
  end loop;
  return null;
end $$;
revoke all on function app.ia_caderno_problema(text) from public, anon, authenticated;

-- O mesmo texto sem o que faria a IA parar (para o que entra sozinho: o treino e o
-- trecho do cliente e da IA na correção).
create or replace function app.ia_caderno_sem_problema(p_texto text) returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v   text := coalesce(p_texto, '');
  v_p jsonb;
  v_i integer := 0;
begin
  v := regexp_replace(v, '[^[:space:]@]*@[^[:space:]@]*', '[contato tirado]', 'g');
  v := regexp_replace(v, '(www\.)?instagram\.com/[^[:space:]]*', '[contato tirado]', 'gi');
  loop
    v_p := app.ia_caderno_problema(v);
    exit when v_p is null or v_i >= 20;
    if coalesce(v_p ->> 'trecho', '') = '' then
      exit;
    end if;
    v := replace(v, v_p ->> 'trecho', '[número tirado]');
    v_i := v_i + 1;
  end loop;
  return v;
end $$;
revoke all on function app.ia_caderno_sem_problema(text) from public, anon, authenticated;

-- A rede de segurança: nenhuma nota com o problema entra nem é editada para tê-lo.
create or replace function app.ia_caderno_sem_trava() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_p jsonb := app.ia_caderno_problema(new.texto);
begin
  if v_p is not null then
    raise exception 'Nota do caderno com trecho que faria a IA parar (%): "%"',
      v_p ->> 'motivo', v_p ->> 'trecho'
      using errcode = '22023';
  end if;
  return new;
end $$;
revoke all on function app.ia_caderno_sem_trava() from public, anon, authenticated;

drop trigger if exists ia_caderno_sem_trava on public.ia_caderno;
create trigger ia_caderno_sem_trava before insert or update of texto on public.ia_caderno
  for each row execute function app.ia_caderno_sem_trava();
  $ddl$;

  -- "Ensinar" e o lápis: recusa dizendo o trecho.
  execute $ddl$
create or replace function public.ia_caderno_escrever(p_texto text, p_id bigint default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_texto text := btrim(coalesce(p_texto, ''));
  v_id    bigint;
  v_p     jsonb;
begin
  if auth.uid() is null or not app.is_manager() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if char_length(v_texto) < 3 then
    return jsonb_build_object('ok', false, 'motivo', 'texto_curto');
  end if;
  if char_length(v_texto) > 2000 then
    return jsonb_build_object('ok', false, 'motivo', 'texto_longo');
  end if;
  -- A trava (27/11/2026): o que faria a IA parar de responder não entra.
  v_p := app.ia_caderno_problema(v_texto);
  if v_p is not null then
    return jsonb_build_object('ok', false, 'motivo', 'trava_a_ia',
                              'tipo', v_p ->> 'motivo', 'trecho', v_p ->> 'trecho');
  end if;
  if p_id is null then
    insert into public.ia_caderno (texto, origem, criado_por)
    values (v_texto, 'tela', auth.uid()) returning id into v_id;
  else
    update public.ia_caderno
       set texto = v_texto, atualizado_por = auth.uid(), atualizado_em = now()
     where id = p_id and ativo
    returning id into v_id;
    if v_id is null then
      return jsonb_build_object('ok', false, 'motivo', 'linha_inexistente');
    end if;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
revoke all on function public.ia_caderno_escrever(text, bigint) from public, anon;
grant execute on function public.ia_caderno_escrever(text, bigint) to authenticated;
  $ddl$;

  -- "Corrigir": recusa o que a pessoa escreveu e limpa o trecho do cliente e da IA.
  execute $ddl$
create or replace function public.ia_resposta_avaliar(p_resposta_id uuid, p_avaliacao text,
                                                      p_correcao text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r          public.ia_respostas%rowtype;
  v_corr     text := nullif(btrim(coalesce(p_correcao, '')), '');
  v_cliente  text;
  v_disse    text;
  v_caderno  bigint;
  v_p        jsonb;
begin
  if auth.uid() is null or not app.is_manager() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if p_avaliacao not in ('boa', 'corrigir') then
    return jsonb_build_object('ok', false, 'motivo', 'avaliacao_invalida');
  end if;
  if p_avaliacao = 'corrigir' and v_corr is null then
    return jsonb_build_object('ok', false, 'motivo', 'sem_correcao');
  end if;
  if v_corr is not null and char_length(v_corr) > 1500 then
    return jsonb_build_object('ok', false, 'motivo', 'correcao_longa');
  end if;
  -- A trava (27/11/2026): a correção vira nota do caderno.
  v_p := app.ia_caderno_problema(v_corr);
  if p_avaliacao = 'corrigir' and v_p is not null then
    return jsonb_build_object('ok', false, 'motivo', 'trava_a_ia',
                              'tipo', v_p ->> 'motivo', 'trecho', v_p ->> 'trecho');
  end if;
  select * into r from public.ia_respostas where id = p_resposta_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'resposta_inexistente');
  end if;

  update public.ia_respostas
     set avaliacao = p_avaliacao,
         correcao = case when p_avaliacao = 'corrigir' then v_corr end,
         avaliada_por = auth.uid(), avaliada_em = now()
   where id = r.id;

  if p_avaliacao = 'corrigir' then
    select left(coalesce(nullif(btrim(m.body), ''), m.transcript, ''), 300) into v_cliente
      from public.messages m where m.id = r.em_resposta_a;
    v_disse := left(coalesce(app.sem_assinatura(r.corpo), r.corpo), 300);
    insert into public.ia_caderno (texto, origem, conversation_id, message_id, criado_por)
    values (left(app.ia_caderno_sem_problema(
              'Correção de uma resposta: '
              || coalesce('quando o cliente escreveu "' || nullif(v_cliente, '') || '", ', '')
              || 'você respondeu "' || v_disse || '". O certo era: ' || v_corr), 2000),
            'correcao', r.conversation_id, r.message_id, auth.uid())
    returning id into v_caderno;
  end if;
  return jsonb_build_object('ok', true, 'caderno_id', v_caderno);
end $$;
revoke all on function public.ia_resposta_avaliar(uuid, text, text) from public, anon;
grant execute on function public.ia_resposta_avaliar(uuid, text, text) to authenticated;
  $ddl$;

  -- O treino: a nota que a IA anota na conversa do treino entra limpa.
  execute $ddl$
create or replace function public.ia_atendente_anotar(
  p_conversation_id uuid, p_message_id uuid, p_textos text[])
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_texto text;
  v_n     int := 0;
begin
  if p_conversation_id is distinct from app.ia_conversa_de_treino() then
    raise exception 'Só a conversa do treino anota no caderno da IA' using errcode = '42501';
  end if;
  foreach v_texto in array coalesce(p_textos, '{}'::text[]) loop
    v_texto := btrim(app.ia_caderno_sem_problema(left(btrim(coalesce(v_texto, '')), 2000)));
    continue when char_length(v_texto) < 3;
    insert into public.ia_caderno (texto, origem, conversation_id, message_id)
    values (left(v_texto, 2000), 'treino', p_conversation_id, p_message_id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function public.ia_atendente_anotar(uuid, uuid, text[]) from public, anon, authenticated;
grant execute on function public.ia_atendente_anotar(uuid, uuid, text[]) to service_role;
  $ddl$;
end
$imova$;

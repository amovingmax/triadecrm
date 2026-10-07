-- =====================================================================
-- O que a Meta manda e o CRM não conhecia
--
-- O Rafael, em 07/10/2026, com o print de uma conversa: quatro mensagens
-- seguidas da mesma pessoa, cada uma dizendo "Aviso do WhatsApp sem arquivo
-- guardado: o CRM não baixou esta mídia da Meta". "Veja o que é isso que não
-- está carregando."
--
-- ===========================================================================
-- O QUE ACONTECIA
-- ===========================================================================
-- O webhook repassa o tipo da mensagem como a Meta o escreve, e
-- `public.wa_entrada_registrar` o convertia para `app.msg_type`. O que não
-- estava no enum — `sticker` (a figurinha, o mais comum de todos),
-- `unsupported` (visualização única, enquete, evento, mensagem editada),
-- `location`, `contacts`, `button` — virava `system` e o tipo original se
-- perdia. Duas consequências:
--
--   · a figurinha nunca era baixada: o worker só baixa foto, vídeo,
--     documento e áudio, e a passada de recuperação procura por esses tipos;
--   · a tela tratava todo tipo que não é texto como mídia, e escrevia "o CRM
--     não baixou esta mídia" até para o que nunca foi mídia.
--
-- ===========================================================================
-- O QUE MUDA
-- ===========================================================================
--   1. `sticker` passa a ser `image` (é uma imagem webp, que o balde aceita
--      desde 17/09) e `button` passa a ser `interactive` (é a resposta a um
--      botão de modelo, e o texto do botão vem como corpo).
--   2. O tipo como a Meta o mandou fica guardado em `messages.tipo_na_meta`
--      sempre que ele não é o mesmo que o CRM gravou. É o que a tela usa para
--      dizer "figurinha" e "a Meta não entrega este tipo", e é o que permite,
--      da próxima vez, saber o que chegou sem ir atrás do webhook.
--   3. O que JÁ chegou é reclassificado pela carga crua do webhook
--      (`webhook_deliveries.payload`). A figurinha dos últimos 30 dias vira
--      imagem, e a passada de recuperação do worker-wa (`wa_midias_sem_arquivo`)
--      a baixa sozinha na próxima volta — sem mexer no worker.
--
-- O que NÃO muda: nenhuma mensagem deixa de entrar. Tipo que continuar
-- desconhecido segue virando `system`, agora com o nome guardado.
--
-- RF-CON-03, RF-CON-05
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · O tipo original
-- ---------------------------------------------------------------------
alter table public.messages add column if not exists tipo_na_meta text;

comment on column public.messages.tipo_na_meta is
  'O tipo da mensagem como a Meta o mandou, quando não é o mesmo de messages.type: "sticker" (gravada como image), "button" (interactive), "unsupported", "location", "contacts"… Nulo quando os dois coincidem. Desde 07/10/2026.';


-- ---------------------------------------------------------------------
-- 2 · A tradução, num lugar só
-- ---------------------------------------------------------------------
create or replace function app.wa_tipo_da_meta(p_type text)
returns app.msg_type
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_bruto text := lower(nullif(trim(coalesce(p_type, '')), ''));
begin
  if v_bruto is null then
    return 'text'::app.msg_type;
  end if;
  -- A figurinha é uma imagem webp (às vezes animada): o balde a aceita e o
  -- navegador a mostra como qualquer foto.
  if v_bruto = 'sticker' then
    return 'image'::app.msg_type;
  end if;
  -- A resposta a um botão de modelo ("Quero saber mais"): o texto do botão
  -- chega como corpo, igual ao botão interativo.
  if v_bruto = 'button' then
    return 'interactive'::app.msg_type;
  end if;
  begin
    return v_bruto::app.msg_type;
  exception when invalid_text_representation then
    -- Tipo que a Meta inventou e nós ainda não conhecemos entra como
    -- `system`: perder a mensagem porque o enum não acompanhou seria
    -- perder o que a pessoa escreveu por causa de uma coluna nossa.
    return 'system'::app.msg_type;
  end;
end $$;
comment on function app.wa_tipo_da_meta(text) is
  'O tipo de mensagem do CRM para um tipo da Meta: sticker → image, button → interactive, o que o enum conhece → ele mesmo, o resto → system. Nunca falha.';
revoke all on function app.wa_tipo_da_meta(text) from public, anon, authenticated;
grant execute on function app.wa_tipo_da_meta(text) to service_role;


-- ---------------------------------------------------------------------
-- 3 · A entrada usa a tradução e guarda o original
-- ---------------------------------------------------------------------
-- Mesma assinatura (os grants ficam). O resto do caminho não muda: quem grava
-- é `app.wa_registrar_entrada`; o tipo original entra depois, na linha que ela
-- devolveu, e só quando difere do gravado.
create or replace function public.wa_entrada_registrar(p_wamid text, p_business_number text, p_peer_phone text, p_type text default 'text'::text, p_body text default null::text, p_media_id text default null::text, p_media_mime text default null::text, p_occurred_at timestamp with time zone default now(), p_peer_user_id text default null::text, p_peer_name text default null::text)
 returns jsonb
 language plpgsql
 set search_path to ''
as $function$
declare
  v_bruto text := lower(nullif(trim(coalesce(p_type, '')), ''));
  v_tipo  app.msg_type := app.wa_tipo_da_meta(p_type);
  v_ret   jsonb;
begin
  v_ret := app.wa_registrar_entrada(p_wamid, p_business_number, p_peer_phone, v_tipo,
                                    p_body, p_media_id, p_media_mime,
                                    coalesce(p_occurred_at, now()), p_peer_user_id, p_peer_name);
  if v_bruto is not null and v_bruto <> v_tipo::text and (v_ret ->> 'message_id') is not null then
    update public.messages
       set tipo_na_meta = left(v_bruto, 40)
     where id = (v_ret ->> 'message_id')::uuid
       and tipo_na_meta is null;
  end if;
  return v_ret;
end $function$;
comment on function public.wa_entrada_registrar(text, text, text, text, text, text, text, timestamptz, text, text) is
  'Mensagem RECEBIDA pelo worker-wa: traduz o tipo da Meta (app.wa_tipo_da_meta), grava pela app.wa_registrar_entrada e guarda o tipo original em messages.tipo_na_meta quando ele difere do gravado.';


-- ---------------------------------------------------------------------
-- 4 · O que já chegou
-- ---------------------------------------------------------------------
-- O tipo original de cada mensagem `system` recebida sai da carga crua do
-- webhook. Banco novo não tem nada aqui, e o bloco não faz nada.
with original as (
  select distinct on (msg ->> 'id') msg ->> 'id' as wamid, lower(msg ->> 'type') as tipo
    from public.webhook_deliveries w
    cross join lateral jsonb_path_query(w.payload, '$.entry[*].changes[*].value.messages[*]') msg
   where w.source = 'meta'
     and (msg ->> 'id') in (select m.wa_message_id from public.messages m
                             where m.direction = 'in'::app.msg_direction
                               and m.type = 'system'::app.msg_type
                               and m.tipo_na_meta is null
                               and m.wa_message_id is not null)
   order by msg ->> 'id', w.received_at
)
update public.messages m
   set tipo_na_meta = left(o.tipo, 40)
  from original o
 where m.wa_message_id = o.wamid
   and m.tipo_na_meta is null
   and o.tipo is not null;

-- A figurinha que a carga crua não alcançar ainda se reconhece pelo arquivo:
-- mídia webp numa mensagem `system` não é outra coisa.
update public.messages
   set tipo_na_meta = 'sticker'
 where direction = 'in'::app.msg_direction
   and type = 'system'::app.msg_type
   and tipo_na_meta is null
   and media_id is not null
   and media_mime ilike 'image/webp%';

-- E agora cada uma vira o que é. A figurinha com `media_id` dos últimos 30
-- dias entra na fila de recuperação do worker por ter virado `image`.
update public.messages
   set type = app.wa_tipo_da_meta(tipo_na_meta)
 where direction = 'in'::app.msg_direction
   and type = 'system'::app.msg_type
   and tipo_na_meta is not null
   and app.wa_tipo_da_meta(tipo_na_meta) <> 'system'::app.msg_type;

do $$
declare
  r record;
begin
  for r in select coalesce(tipo_na_meta, '(sem tipo)') as t, type::text as agora, count(*) as n
             from public.messages
            where direction = 'in'::app.msg_direction and tipo_na_meta is not null
            group by 1, 2 order by 3 desc
  loop
    raise notice 'mensagens recebidas com tipo da Meta "%": % (agora %)', r.t, r.n, r.agora;
  end loop;
end $$;

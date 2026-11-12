-- =====================================================================
-- O limite da Meta chega ao CRM (Disparos, 12/11/2026)
--
-- Ao publicar os Disparos (20261112100000), o banco da KOMUNE respondeu
-- `teto_da_meta` NULO: a regra nova caía na reserva e o teto ficava em 45.
-- Duas razões, as duas antigas (desde 25/09):
--
--   1. O NÚMERO NÃO BATIA. O worker-wa grava o número como a Graph o escreve
--      ("+55 84 9931-8888", sem o nono dígito, com espaço e hífen), e
--      `app.wa_teto_da_meta` procura `app.wa_numero_padrao()` em E.164
--      ("+5584999318888"). 1.982 leituras de nota GREEN, nenhuma valendo.
--      Agora `public.wa_saude_registrar` grava em E.164
--      (`app.normalize_phone_br`) e `app.wa_teto_da_meta` compara as linhas
--      antigas pelo mesmo normalizador.
--   2. O TIER NUNCA FOI GRAVADO. A leitura periódica da Graph não pede o
--      limite (o campo antigo, `messaging_limit_tier`, a Meta aposentou; o
--      atual é `whatsapp_business_manager_messaging_limit`), e o webhook
--      `business_capability_update` só avisa quando o limite MUDA. O worker
--      passa a pedir o campo atual (apps/workers/src/whatsapp/saude.ts), mas
--      isso só vale quando o worker da KOMUNE for publicado de novo.
--
-- ATÉ LÁ, O LIMITE INFORMADO POR GENTE. `wa_saude_numero.origem` ganha
-- 'pessoa', e `public.wa_limite_informar(tier)` (admin e gestor) grava o
-- limite que alguém viu no Meta Business. Vale como qualquer outra notícia: a
-- última que falou de limite manda, e a próxima da Meta passa por cima. Nesta
-- migração, só no banco da KOMUNE, entra o TIER_2K que o usuário informou em
-- 12/11/2026 ("temos 2k de mensagens disponíveis para envio em massa por dia").
--
-- COMO DESFAZER: reaplicar `public.wa_saude_registrar` e `app.wa_teto_da_meta`
-- de 20260925160000; `drop function public.wa_limite_informar(text)`; a linha
-- informada fica (a tabela é só de acréscimo) e perde valor na próxima notícia
-- da Meta.
--
-- RF-CON-10 · ADR-03
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Quem pode dar a notícia
-- ---------------------------------------------------------------------
alter table public.wa_saude_numero drop constraint if exists wa_saude_numero_origem_check;
alter table public.wa_saude_numero
  add constraint wa_saude_numero_origem_check check (origem in ('webhook', 'graph', 'pessoa'));

-- ---------------------------------------------------------------------
-- 2. O registro grava o número em E.164 (definição viva de 20260925160000)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.wa_saude_registrar(p_item jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id bigint;
begin
  insert into public.wa_saude_numero (numero, origem, campo, evento, qualidade,
                                      limite_anterior, limite_atual, conversas_por_dia,
                                      restricoes, banido, payload, ocorrido_em)
  -- NOVO (12/11/2026): o número em E.164. A Graph manda "+55 84 9931-8888"
  -- (sem o nono dígito, com espaço e hífen), e a porteira procura
  -- "+5584999318888": sem normalizar, nenhuma linha valia.
  values (coalesce(app.normalize_phone_br(nullif(btrim(coalesce(p_item ->> 'numero', '')), '')),
                   nullif(btrim(coalesce(p_item ->> 'numero', '')), ''),
                   app.wa_numero_padrao()),
          coalesce(nullif(p_item ->> 'origem', ''), 'webhook'),
          coalesce(nullif(p_item ->> 'campo', ''), 'desconhecido'),
          nullif(p_item ->> 'evento', ''),
          nullif(upper(coalesce(p_item ->> 'qualidade', '')), ''),
          nullif(p_item ->> 'limite_anterior', ''),
          nullif(p_item ->> 'limite_atual', ''),
          nullif(p_item ->> 'conversas_por_dia', '')::int,
          coalesce(p_item -> 'restricoes', '[]'::jsonb),
          coalesce((p_item ->> 'banido')::boolean, false),
          coalesce(p_item -> 'payload', '{}'::jsonb),
          coalesce((p_item ->> 'ocorrido_em')::timestamptz, now()))
  returning id into v_id;
  return v_id;
end $function$;


-- ---------------------------------------------------------------------
-- 3. O teto da Meta reconhece as linhas antigas (definição viva de 20260925160000)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.wa_teto_da_meta(p_numero text DEFAULT NULL::text, p_quando timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_num      text := coalesce(nullif(btrim(coalesce(p_numero, '')), ''), app.wa_numero_padrao());
  -- NOVO (12/11/2026): as linhas antigas guardaram o número como a Graph o
  -- escreve ("+55 84 9931-8888"); a comparação passa pelo mesmo normalizador.
  v_quando   timestamptz := coalesce(p_quando, now());
  v_qual     text;
  v_tier     text;
  v_crua     int;
  v_teto     int;
  v_restr    jsonb;
  v_banido   boolean := false;
  v_sai      boolean := false;
  v_ent      boolean := false;
  v_ate      timestamptz;
  v_sem_fim  boolean := false;
  r          jsonb;
begin
  -- A nota: a última linha que trouxe uma.
  select s.qualidade into v_qual
    from public.wa_saude_numero s
   where (v_num is null or s.numero is null or s.numero = v_num
          or app.normalize_phone_br(s.numero) = v_num)
     and s.qualidade is not null
     and s.ocorrido_em <= v_quando
   order by s.ocorrido_em desc, s.id desc
   limit 1;

  -- O tier: a última linha que trouxe um.
  select s.limite_atual, s.conversas_por_dia into v_tier, v_crua
    from public.wa_saude_numero s
   where (v_num is null or s.numero is null or s.numero = v_num
          or app.normalize_phone_br(s.numero) = v_num)
     and (s.limite_atual is not null or s.conversas_por_dia is not null)
     and s.ocorrido_em <= v_quando
   order by s.ocorrido_em desc, s.id desc
   limit 1;

  -- A restrição e o banimento: a última linha que falou de conta.
  select s.restricoes, s.banido into v_restr, v_banido
    from public.wa_saude_numero s
   where (v_num is null or s.numero is null or s.numero = v_num
          or app.normalize_phone_br(s.numero) = v_num)
     and s.campo = 'account_update'
     and s.ocorrido_em <= v_quando
   order by s.ocorrido_em desc, s.id desc
   limit 1;

  -- Restrição vencida cai sozinha: `expiration` é unix em segundos.
  for r in select jsonb_array_elements(coalesce(v_restr, '[]'::jsonb)) loop
    if (r ->> 'expiration') is not null
       and to_timestamp((r ->> 'expiration')::numeric) <= v_quando then
      continue;
    end if;
    if (r ->> 'restriction_type') = 'RESTRICTED_BIZ_INITIATED_MESSAGING' then
      v_sai := true;
    elsif (r ->> 'restriction_type') = 'RESTRICTED_CUSTOMER_INITIATED_MESSAGING' then
      v_ent := true;
    else
      continue;   -- as outras sete são guardadas e não viram teto
    end if;
    if (r ->> 'expiration') is null then
      -- Restrição vigente sem prazo: `ate` fica nulo, que é "não sei quando".
      v_sem_fim := true;
    else
      v_ate := greatest(coalesce(v_ate, to_timestamp((r ->> 'expiration')::numeric)),
                        to_timestamp((r ->> 'expiration')::numeric));
    end if;
  end loop;
  if v_sem_fim then
    v_ate := null;
  end if;

  -- TIER_NOT_SET e TIER_UNLIMITED não são teto: são ausência de teto.
  v_teto := case coalesce(v_tier, '')
              when 'TIER_50'   then 50
              when 'TIER_250'  then 250
              when 'TIER_1K'   then 1000      -- aparece em contas antigas
              when 'TIER_2K'   then 2000
              when 'TIER_10K'  then 10000
              when 'TIER_100K' then 100000
              else null
            end;
  v_teto := coalesce(v_teto, v_crua);

  if v_qual = 'RED' then
    v_teto := 0;
  elsif v_qual = 'YELLOW' and v_teto is not null then
    v_teto := v_teto / 2;
  end if;

  return jsonb_build_object(
    'teto_dia',        v_teto,
    'restrito_saida',  v_sai,
    'restrito_entrada', v_ent,
    'banido',          coalesce(v_banido, false),
    'ate',             v_ate,
    'qualidade',       v_qual,
    'tier',            v_tier,
    'numero',          v_num);
end $function$;


-- ---------------------------------------------------------------------
-- 4. O limite informado por gente
-- ---------------------------------------------------------------------
create or replace function public.wa_limite_informar(p_tier text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tier text := upper(btrim(coalesce(p_tier, '')));
begin
  if auth.uid() is null or not app.admin_ou_gestor() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if v_tier not in ('TIER_250', 'TIER_1K', 'TIER_2K', 'TIER_10K', 'TIER_100K', 'TIER_UNLIMITED') then
    return jsonb_build_object('ok', false, 'motivo', 'limite_invalido');
  end if;
  -- Sem número configurado a linha ficaria sem número, e linha sem número vale
  -- para qualquer um (`app.wa_teto_da_meta`).
  if app.wa_numero_padrao() is null then
    return jsonb_build_object('ok', false, 'motivo', 'whatsapp_nao_configurado');
  end if;
  perform public.wa_saude_registrar(jsonb_build_object(
    'origem', 'pessoa', 'campo', 'limite_informado', 'evento', 'INFORMADO',
    'limite_atual', v_tier,
    'payload', jsonb_build_object('informado_por', auth.uid(), 'informado_em', now())));
  return jsonb_build_object('ok', true, 'teto', app.wa_teto_da_meta(null, now()) -> 'teto_dia');
end $$;
comment on function public.wa_limite_informar(text) is
  'Grava o limite de conversas por dia que alguém viu no Meta Business (origem pessoa), enquanto o worker não lê o limite da Graph. Admin e gestor. Vale até a próxima notícia da Meta (12/11/2026).';
revoke all on function public.wa_limite_informar(text) from public, anon;
grant execute on function public.wa_limite_informar(text) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Só na KOMUNE: o TIER_2K que o usuário informou
-- ---------------------------------------------------------------------
do $komune$
begin
  if coalesce((select i.empresa from app.identidade i limit 1), '') <> 'komune'
     or app.wa_numero_padrao() is null then
    return;
  end if;
  perform public.wa_saude_registrar(jsonb_build_object(
    'origem', 'pessoa', 'campo', 'limite_informado', 'evento', 'INFORMADO',
    'limite_atual', 'TIER_2K',
    'payload', jsonb_build_object(
      'informado_por', 'usuário, ao pedir os Disparos',
      'informado_em', '2026-11-12',
      'frase', 'temos 2k de mensagens disponíveis para envio em massa por dia')));
end
$komune$;

-- =====================================================================
-- O CRM guarda o que a Meta diz sobre o nosso número
-- =====================================================================
-- POR QUE ESTA MIGRAÇÃO EXISTE. O teto de envio do CRM é só o NOSSO: o
-- aquecimento (20 → 35 → 45) e os 150/dia do RF-CON-10. A Meta tem o dela, e
-- ela muda sem avisar — a nota de qualidade cai, o tier desce, a conta entra em
-- restrição. Hoje o CRM não fica sabendo de nada disso: `whatsapp.numero` em
-- `app_settings` guarda uma `qualidade` gravada UMA VEZ, na conexão
-- (20260914100000:670), e o webhook joga fora tudo o que não é `field=messages`
-- (`supabase/functions/wa-webhook/extrair.ts`).
--
-- Com uma pessoa enviando, isso dava: ela via as mensagens falhando e parava.
-- Com o robô enviando, ninguém vê — e "a Meta cortou o número" é o tipo de
-- coisa que se descobre com a conta já suspensa.
--
-- A TABELA É HISTÓRICO, não estado. Append-only pelo mesmo gatilho dos eventos
-- de consentimento: quando a Meta restringe e depois solta, a pergunta que
-- importa é "desde quando" e "quantas vezes", e as duas se perdem num `update`.
--
-- O QUE NÃO SE SABE NÃO VIRA PERMISSÃO NEM PROIBIÇÃO. Sem linha nenhuma,
-- `teto_dia` é nulo e nada muda. "Não sei" nunca vira "então pode", e também
-- nunca vira "então pare" — parar o envio porque o webhook não foi assinado
-- seria o CRM se punindo por uma configuração de painel.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. O histórico
-- ---------------------------------------------------------------------
create table if not exists public.wa_saude_numero (
  id                bigserial primary key,
  numero            text,                                  -- E.164; null quando a Meta não disse (account_update é da WABA)
  origem            text not null check (origem in ('webhook', 'graph')),
  campo             text not null,                         -- o `field` do webhook, ou 'phone_number' na leitura da Graph
  evento            text,                                  -- ONBOARDING | THROUGHPUT_UPGRADE | FLAGGED | UNFLAGGED | ACCOUNT_RESTRICTION | ...
  qualidade         text check (qualidade in ('GREEN', 'YELLOW', 'RED', 'UNKNOWN')),
  limite_anterior   text,
  limite_atual      text,                                  -- TIER_50 … TIER_UNLIMITED
  conversas_por_dia int,                                   -- quando a Meta manda o número cru
  restricoes        jsonb not null default '[]'::jsonb,    -- restriction_info[] como veio
  banido            boolean not null default false,
  payload           jsonb not null default '{}'::jsonb,    -- o `value` inteiro, para a pergunta que ninguém fez ainda
  ocorrido_em       timestamptz not null default now(),
  created_at        timestamptz not null default now()
);
comment on table public.wa_saude_numero is
  'O que a Meta diz sobre o nosso número, linha a linha: nota de qualidade, tier de conversas por dia, restrições e banimento. Append-only — a pergunta que importa é "desde quando", e ela se perde num update. Alimentada pelo webhook (phone_number_quality_update, account_update, business_capability_update) e pela leitura periódica da Graph.';
create index if not exists wa_saude_numero_idx
  on public.wa_saude_numero (numero, ocorrido_em desc);
create index if not exists wa_saude_numero_quando_idx
  on public.wa_saude_numero (ocorrido_em desc);

drop trigger if exists wa_saude_numero_append_only on public.wa_saude_numero;
create trigger wa_saude_numero_append_only before update or delete on public.wa_saude_numero
  for each row execute function app.forbid_change();

alter table public.wa_saude_numero enable row level security;
drop policy if exists wa_saude_numero_select on public.wa_saude_numero;
create policy wa_saude_numero_select on public.wa_saude_numero
  for select to authenticated
  using ((select app.role()) in ('admin'::app.user_role, 'gestor'::app.user_role));

-- ---------------------------------------------------------------------
-- 2. O registrador
-- ---------------------------------------------------------------------
-- Uma porta só, para o webhook e para a Graph. `coalesce(numero, padrão)`
-- porque `account_update` NÃO traz `phone_number` em `value`: a restrição é da
-- WABA, e o número que ela atinge é o nosso.
create or replace function public.wa_saude_registrar(p_item jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  insert into public.wa_saude_numero (numero, origem, campo, evento, qualidade,
                                      limite_anterior, limite_atual, conversas_por_dia,
                                      restricoes, banido, payload, ocorrido_em)
  values (coalesce(nullif(btrim(coalesce(p_item ->> 'numero', '')), ''), app.wa_numero_padrao()),
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
end $$;
comment on function public.wa_saude_registrar(jsonb) is
  'Grava uma linha de saúde do número. Porta única do webhook e da leitura periódica da Graph. O número cai no padrão de app.wa_numero_padrao() quando a Meta não o manda — account_update é da WABA, não do número.';
revoke all on function public.wa_saude_registrar(jsonb) from public, anon, authenticated;
grant execute on function public.wa_saude_registrar(jsonb) to service_role;

-- ---------------------------------------------------------------------
-- 3. O teto da Meta, lido do histórico
-- ---------------------------------------------------------------------
-- LÊ A ÚLTIMA LINHA QUE SOUBE DE CADA COISA, e não a última linha. As três
-- notícias chegam por campos diferentes e em momentos diferentes: a qualidade
-- vem de `phone_number_quality_update` e da Graph, o tier vem de
-- `business_capability_update`, a restrição vem de `account_update`. Pegar "a
-- última linha" faria um `business_capability_update` apagar a restrição que
-- chegou dez minutos antes.
--
-- A QUALIDADE DOBRA DENTRO DO TETO: YELLOW → metade, RED → zero. Não é um
-- motivo separado no cálculo, é o mesmo teto valendo menos — mas o MOTIVO que
-- sai de `app.pode_enviar` é outro (`qualidade_vermelha`), porque nota
-- vermelha e teto cheio se resolvem em prazos diferentes: uma espera a próxima
-- abertura, a outra espera o número melhorar.
create or replace function app.wa_teto_da_meta(p_numero text default null,
                                               p_quando timestamptz default now())
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_num      text := coalesce(nullif(btrim(coalesce(p_numero, '')), ''), app.wa_numero_padrao());
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
   where (v_num is null or s.numero is null or s.numero = v_num)
     and s.qualidade is not null
     and s.ocorrido_em <= v_quando
   order by s.ocorrido_em desc, s.id desc
   limit 1;

  -- O tier: a última linha que trouxe um.
  select s.limite_atual, s.conversas_por_dia into v_tier, v_crua
    from public.wa_saude_numero s
   where (v_num is null or s.numero is null or s.numero = v_num)
     and (s.limite_atual is not null or s.conversas_por_dia is not null)
     and s.ocorrido_em <= v_quando
   order by s.ocorrido_em desc, s.id desc
   limit 1;

  -- A restrição e o banimento: a última linha que falou de conta.
  select s.restricoes, s.banido into v_restr, v_banido
    from public.wa_saude_numero s
   where (v_num is null or s.numero is null or s.numero = v_num)
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
end $$;
comment on function app.wa_teto_da_meta(text, timestamptz) is
  'O que a Meta permite hoje para o nosso número, lido de public.wa_saude_numero: teto de conversas iniciadas por dia (dobrado pela nota — YELLOW metade, RED zero), restrição de saída, restrição de entrada, banimento e até quando. Sem histórico nenhum, teto_dia é NULO: "não sei" não vira nem permissão nem proibição.';
revoke all on function app.wa_teto_da_meta(text, timestamptz) from public, anon;
grant execute on function app.wa_teto_da_meta(text, timestamptz) to authenticated, service_role;

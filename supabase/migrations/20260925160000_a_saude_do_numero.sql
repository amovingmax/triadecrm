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


-- ---------------------------------------------------------------------
-- 4. A porteira passa a conhecer a Meta
-- ---------------------------------------------------------------------
-- O TETO EFETIVO É O MENOR ENTRE O NOSSO E O DELA. Hoje a Meta libera 2.000
-- conversas novas por dia e o nosso aquecimento está em 45: o menor continua
-- sendo o nosso, e nada muda na prática. A peça existe para o dia em que a
-- Meta cortar sem avisar — que é o dia em que ninguém estará olhando.
--
-- ONDE CADA COISA ENTRA, e por quê:
--   passo 1.5 (antes da janela de 24 h): banimento e restrição de ENTRADA.
--     `RESTRICTED_CUSTOMER_INITIATED_MESSAGING` derruba até a resposta dentro
--     da janela — e o passo 2 liberaria. Depois do passo 2 seria tarde.
--   passo 4.5: restrição de SAÍDA, que só atinge o que a empresa começa.
--   passo 5: `least(nosso, dela)`, com `qualidade_vermelha` como motivo
--     próprio quando o teto dela é zero.
--   passo 6: o mesmo `least` sobre os 150/dia.
--
-- OS QUATRO MOTIVOS NOVOS SÃO ESPERA, e não morte: o lote de campanha dorme
-- em vez de queimar a ficha. `app.envios_em_massa_rodar` já adormece o envio
-- com `proximo_em` em vez de pular o item — nenhuma linha do motor muda.
create or replace function app.pode_enviar(p_conversation_id uuid,
                                           p_primeiro_contato boolean default false,
                                           p_tem_template     boolean default false,
                                           p_quando           timestamptz default now())
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c          public.conversations%rowtype;
  v_quando   timestamptz := coalesce(p_quando, now());
  v_dia      date;
  v_motivo   text;
  v_janela   jsonb;
  v_respondeu boolean;
  v_teto     int;
  v_usados   int;
  v_cfg      jsonb;
  v_td       int;
  v_th       int;
  v_meta     jsonb;
  v_meta_dia int;
begin
  select * into c from public.conversations where id = p_conversation_id;
  if not found then
    return jsonb_build_object('pode', false, 'motivo', 'conversa_inexistente', 'quando', null);
  end if;

  -- 1 · Nunca mais.
  v_motivo := app.wa_motivo_de_recusa(c.organization_id, c.contact_id, c.peer_phone_e164);
  if v_motivo is not null then
    return jsonb_build_object('pode', false, 'motivo', v_motivo, 'quando', null);
  end if;

  -- 1.5 · O que a Meta decidiu sobre a conta. Vem ANTES da janela de 24 h
  --       porque a restrição de ENTRADA derruba a resposta dentro dela.
  v_meta := app.wa_teto_da_meta(c.business_number, v_quando);
  if coalesce((v_meta ->> 'banido')::boolean, false) then
    -- Seis horas: não há o que fazer agora, e voltar a perguntar em seis horas
    -- é mais barato que parar o lote para sempre por um DISABLE que às vezes
    -- vira REINSTATE no mesmo dia.
    return jsonb_build_object('pode', false, 'motivo', 'conta_banida',
                              'quando', v_quando + interval '6 hours');
  end if;
  if coalesce((v_meta ->> 'restrito_entrada')::boolean, false) then
    return jsonb_build_object('pode', false, 'motivo', 'meta_restringiu_entrada',
                              'quando', (v_meta ->> 'ate')::timestamptz);
  end if;

  -- 2 · Dentro da janela de 24 h, responder é livre: foi a pessoa que
  --     escreveu, e responder rápido é o que a política da Meta e o
  --     RF-CON-04 pedem. Primeiro contato nunca cai aqui — por definição
  --     não existe janela aberta com quem nunca falou com a gente.
  if not p_primeiro_contato and app.janela_de_24h_aberta(c.id, v_quando) then
    return jsonb_build_object('pode', true, 'motivo', null, 'quando', v_quando);
  end if;

  -- 3 · Daqui para baixo é mensagem INICIADA PELA EMPRESA. Fora da janela,
  --     só template aprovado atravessa (R04 §2.1) — é regra da Meta, e
  --     tentar mandar texto livre não dá erro nosso, dá erro deles.
  if not p_tem_template and not app.janela_de_24h_aberta(c.id, v_quando) then
    return jsonb_build_object('pode', false, 'motivo', 'sem_janela_e_sem_template', 'quando', null);
  end if;

  -- 4 · Janela de horário (RF-CON-11): domingo, feriado e fora de hora saem
  --     daqui, porque `app.janela_do_canal` já os trata e devolve a próxima
  --     abertura em America/Fortaleza.
  v_respondeu := c.organization_id is not null and app.ja_respondeu(c.organization_id);
  v_janela := app.janela_do_canal(c.channel, v_quando, v_respondeu);
  if not coalesce((v_janela ->> 'aberta')::boolean, false) then
    return jsonb_build_object('pode', false,
                              'motivo', 'janela_' || coalesce(v_janela ->> 'motivo', 'fechada'),
                              'quando', (v_janela ->> 'abre_em')::timestamptz);
  end if;

  -- 4.5 · Restrição de SAÍDA: só atinge o que a empresa começa, e daqui para
  --       baixo é tudo o que a empresa começa.
  if coalesce((v_meta ->> 'restrito_saida')::boolean, false) then
    return jsonb_build_object('pode', false, 'motivo', 'meta_restringiu_saida',
                              'quando', (v_meta ->> 'ate')::timestamptz);
  end if;

  v_dia := (v_quando at time zone 'America/Fortaleza')::date;
  v_meta_dia := (v_meta ->> 'teto_dia')::int;

  -- 5 · Teto de PRIMEIROS CONTATOS do dia, por canal e por número, agora
  --     limitado também pelo da Meta.
  if p_primeiro_contato then
    v_teto   := least(app.teto_do_canal(c.channel, v_dia), coalesce(v_meta_dia, 2147483647));
    v_usados := app.primeiros_contatos_do_dia(c.channel, v_dia, c.business_number);
    if v_teto <= 0 then
      -- Nota vermelha não é teto cheio. Teto cheio espera a próxima abertura;
      -- nota vermelha espera o número melhorar, e são prazos diferentes.
      return jsonb_build_object('pode', false, 'motivo', 'qualidade_vermelha',
                                'quando', v_quando + interval '6 hours',
                                'usados', v_usados, 'teto', v_teto);
    end if;
    if v_usados >= v_teto then
      return jsonb_build_object('pode', false, 'motivo', 'teto_do_numero',
                                'quando', app.proxima_abertura_do_canal(v_dia, c.channel, v_respondeu),
                                'usados', v_usados, 'teto', v_teto);
    end if;
  end if;

  -- 6 · Tetos de volume iniciado pela empresa: 150/dia e 60/hora (RF-CON-10),
  --     o do dia limitado também pelo da Meta.
  select s.value into v_cfg from public.app_settings s where s.key = 'whatsapp.envio';
  v_td := least(coalesce((v_cfg ->> 'teto_iniciadas_dia')::int, 150),
                coalesce(v_meta_dia, 2147483647));
  v_th := coalesce((v_cfg ->> 'teto_iniciadas_hora')::int, 60);
  if v_td <= 0 then
    return jsonb_build_object('pode', false, 'motivo', 'qualidade_vermelha',
                              'quando', v_quando + interval '6 hours');
  end if;
  if app.iniciadas_pela_empresa(c.business_number,
                                (v_dia::timestamp at time zone 'America/Fortaleza'),
                                ((v_dia + 1)::timestamp at time zone 'America/Fortaleza')) >= v_td then
    return jsonb_build_object('pode', false, 'motivo', 'teto_iniciadas_dia',
                              'quando', app.proxima_abertura_do_canal(v_dia, c.channel, v_respondeu));
  end if;
  if app.iniciadas_pela_empresa(c.business_number, v_quando - interval '1 hour', v_quando) >= v_th then
    return jsonb_build_object('pode', false, 'motivo', 'teto_iniciadas_hora',
                              'quando', v_quando + interval '1 hour');
  end if;

  return jsonb_build_object('pode', true, 'motivo', null, 'quando', v_quando);
end $$;
comment on function app.pode_enviar(uuid, boolean, boolean, timestamptz) is
  'A porteira do envio, na forma de app.pode_tocar: supressão (nunca mais) → o que a Meta decidiu sobre a conta (banimento e restrição de entrada) → janela de 24 h → template obrigatório fora dela → janela de horário do RF-CON-11 → restrição de saída → teto de primeiros contatos, que é o MENOR entre o nosso e o da Meta → tetos de 150/dia e 60/hora, o do dia também limitado pela Meta. Devolve {pode, motivo, quando}; `quando` null significa que não existe uma próxima hora.';

-- Os quatro motivos novos são ESPERA. Um lote de campanha que esbarre neles
-- dorme e continua depois, em vez de queimar a ficha como "pulada": nada do
-- que a Meta decide sobre a NOSSA conta é motivo para descartar um fornecedor.
create or replace function app.envio_motivo_de_espera(p_motivo text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_motivo like 'janela\_%' escape '\'
      or p_motivo in ('teto_do_numero', 'teto_iniciadas_dia', 'teto_iniciadas_hora',
                      'conta_banida', 'meta_restringiu_entrada', 'meta_restringiu_saida',
                      'qualidade_vermelha')
$$;

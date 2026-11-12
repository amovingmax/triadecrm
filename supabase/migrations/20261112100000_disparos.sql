-- =====================================================================
-- Disparos: o limite do dia é o da Meta, e cada disparo diz quantos
--
-- Pedido de 12/11/2026: "temos 2k de mensagens disponíveis para envio em
-- massa por dia, quero a funcionalidade com que podemos escolher para quem
-- enviar, o que enviar e a quantidade de envios". E, sobre o teto: "Eu quero
-- determinar isso no CRM. Eu não quero que a quantidade seja determinada. [...]
-- para testes agora a gente vai enviar apenas para 3 pessoas. Das 2.000
-- disponíveis. Estamos cientes dos custos".
--
-- O motor é o de 21/09 (`envios_em_massa`, onde o bom-dia já roda) e a tela é
-- a de /envios, que volta ao menu como "Disparos". O que impedia os 2.000 eram
-- as travas DO CRM, todas abaixo da Meta:
--
--   * o aquecimento (`cadencia.tetos.whatsapp`: 20 → 35 → 45, teto duro 100);
--   * 150 mensagens iniciadas por dia e 60 por hora (`whatsapp.envio`);
--   * o lote em até 60 por hora, e o relógio mandando UMA por minuto;
--   * 45 a 180 s entre mensagens no worker-wa (≈ 32 por hora).
--
-- O QUE MUDA
--   1. Passado o aquecimento, o teto do número É o da Meta
--      (`app.wa_teto_da_meta`: o tier dobrado pela nota — amarela é metade,
--      vermelha é zero). As duas primeiras semanas de um número novo continuam
--      com 20 e 35. Sem notícia da Meta, valem os números de antes: "não sei"
--      não vira permissão.
--   2. A porteira (`app.pode_enviar`, passo 6) faz o mesmo com os 150/dia; o
--      teto da hora sobe junto, para o dia caber em 8 horas (2.000 → 250/h).
--   3. O disparo vai de 1 a 300 por hora, e o relógio manda quantas couberem
--      na volta quando o passo é menor que 1 minuto. Até 60/h, nada muda.
--   4. O intervalo do worker-wa entre mensagens iniciadas pela empresa cai de
--      45–180 s para 8–24 s, só onde ainda está no padrão (quem mexeu à mão
--      fica como está). O worker lê isso na subida: vale depois de reiniciá-lo.
--      Só no banco da KOMUNE, junto com a chave (ver "SÓ NA KOMUNE" abaixo).
--   5. `public.envio_em_massa_teto` passa a dizer quanto sobra hoje, o tier e
--      quantas mensagens já estão na fila de disparos em curso.
--
-- O QUE NÃO MUDA: supressão e opt-out, a janela de 8h às 17h45 em dia útil, a
-- cortesia de 72 h, a parada automática (3 saídas acima de 2%), o modelo
-- aprovado obrigatório fora da janela de 24 h. A quantidade de cada disparo é
-- escolhida na tela, pessoa a pessoa ou "os N primeiros"; nenhum número fixo
-- foi posto no lugar dos que saíram.
--
-- SÓ NA KOMUNE (decisão do usuário, 12/11/2026). Os itens 1, 2 e 4 dependem
-- da chave `whatsapp.envio.teto_da_meta`, que esta migração liga só no banco
-- que diz ser da KOMUNE (`app.identidade`). Na Imova a chave fica desligada e
-- os limites continuam os de hoje; ligar lá é um `update` na chave. Os itens 3
-- e 5 valem nos dois bancos, porque não soltam nada sozinhos: o ritmo maior é
-- escolha de quem monta o disparo, e a porteira continua decidindo.
--
-- COMO DESFAZER: reaplicar `app.teto_do_canal` de 20260904001700,
-- `app.pode_enviar` e `public.envio_em_massa_teto` de 20260925170000,
-- `public.envio_em_massa_criar` de 20260921110000, `app.envios_em_massa_rodar`
-- de 20261002200000 e `app.wa_motivo_legivel` de 20260905000201; voltar o check
-- de `por_hora` para 1..60 (antes, baixar os lotes acima de 60) e o intervalo
-- de `whatsapp.envio` para 45/180.
--
-- RF-CON-02, RF-CON-10, RF-CON-11 · ADR-03, ADR-06
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. A chave: o teto segue a Meta?
-- ---------------------------------------------------------------------
-- Desligada por padrão: sem a chave, nada muda. É ela, e não a empresa, que as
-- funções perguntam — ligar na Imova depois é um `update`, não uma migração.
create or replace function app.wa_teto_segue_a_meta()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select (s.value ->> 'teto_da_meta')::boolean
                     from public.app_settings s where s.key = 'whatsapp.envio'), false)
$$;
comment on function app.wa_teto_segue_a_meta() is
  'Se o teto do WhatsApp segue o limite que a Meta dá ao número (app_settings whatsapp.envio.teto_da_meta). Ligada só na KOMUNE pela migração 20261112100000 (Disparos, 12/11/2026).';
revoke all on function app.wa_teto_segue_a_meta() from public, anon;
grant execute on function app.wa_teto_segue_a_meta() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 1. O teto do número: aquecimento nas duas primeiras semanas, depois a Meta
-- ---------------------------------------------------------------------
create or replace function app.teto_do_canal(p_channel app.channel, p_dia date)
returns int
language plpgsql
stable
set search_path = ''
as $$
declare
  v      jsonb;
  v_ini  date;
  v_sem  int;
  v_teto int;
  v_duro int;
  v_meta int;
  v_key  text := p_channel::text;
begin
  select s.value into v from public.app_settings s where s.key = 'cadencia.tetos';
  if v is null or not (v ? v_key) then
    return 2147483647;   -- canal sem teto configurado não bloqueia ninguém
  end if;
  v_duro := coalesce((v -> v_key ->> 'teto_duro')::int, 2147483647);

  if p_channel = 'whatsapp'::app.channel then
    v_ini := (v ->> 'inicio')::date;
    v_sem := greatest(floor((p_dia - v_ini) / 7.0)::int, 0);
    if v_sem = 0 then
      v_teto := coalesce((v -> v_key ->> 'semana1')::int, 20);
    elsif v_sem = 1 then
      v_teto := coalesce((v -> v_key ->> 'semana2')::int, 35);
    else
      -- NOVO (12/11/2026, Disparos): com a chave ligada, passado o aquecimento,
      -- quem diz quanto o número aguenta é a Meta, já dobrada pela nota. O
      -- `depois` e o teto duro ficam para a chave desligada e para quando ela
      -- não disse nada.
      if app.wa_teto_segue_a_meta() then
        v_meta := (app.wa_teto_da_meta(null, now()) ->> 'teto_dia')::int;
        if v_meta is not null then
          return v_meta;
        end if;
      end if;
      v_teto := coalesce((v -> v_key ->> 'depois')::int, 45);
    end if;
  else
    v_teto := coalesce((v -> v_key ->> 'padrao')::int, 2147483647);
  end if;
  return least(v_teto, v_duro);
end $$;
comment on function app.teto_do_canal(app.channel, date) is
  'Teto de aberturas do canal naquele dia (RF-CON-10). WhatsApp: 20 e 35 nas duas primeiras semanas de aquecimento a partir de app_settings->cadencia.tetos->inicio; depois, com app.wa_teto_segue_a_meta() ligada (só a KOMUNE, desde 12/11/2026), o teto da Meta (app.wa_teto_da_meta, dobrado pela nota); com ela desligada, ou sem notícia da Meta, o `depois` limitado pelo teto duro.';

-- ---------------------------------------------------------------------
-- 2. A porteira: o passo 6 segue a Meta (definição viva de 20260925170000,
--    com UMA troca, marcada com NOVO)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.pode_enviar(p_conversation_id uuid, p_primeiro_contato boolean DEFAULT false, p_tem_template boolean DEFAULT false, p_quando timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  --     só template aprovado atravessa (R04 §2.1).
  if not p_tem_template and not app.janela_de_24h_aberta(c.id, v_quando) then
    return jsonb_build_object('pode', false, 'motivo', 'sem_janela_e_sem_template', 'quando', null);
  end if;

  -- 4 · Janela de horário (RF-CON-11).
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

  -- 5 · Teto de ABERTURAS do dia, por canal e por número, limitado também
  --     pelo da Meta. SEM `if p_primeiro_contato`: o passo 2 já liberou tudo
  --     o que é resposta dentro da janela, então o que chega aqui é, por
  --     construção, conversa que a EMPRESA está abrindo — e é isso que a Meta
  --     conta e o aquecimento existe para conter.
  v_teto   := least(app.teto_do_canal(c.channel, v_dia), coalesce(v_meta_dia, 2147483647));
  v_usados := app.aberturas_do_dia(c.channel, v_dia, c.business_number);
  if v_teto <= 0 then
    return jsonb_build_object('pode', false, 'motivo', 'qualidade_vermelha',
                              'quando', v_quando + interval '6 hours',
                              'usados', v_usados, 'teto', v_teto);
  end if;
  if v_usados >= v_teto then
    return jsonb_build_object('pode', false, 'motivo', 'teto_do_numero',
                              'quando', app.proxima_abertura_do_canal(v_dia, c.channel, v_respondeu),
                              'usados', v_usados, 'teto', v_teto);
  end if;

  -- 6 · Tetos de volume iniciado pela empresa (RF-CON-10).
  --     NOVO (12/11/2026, Disparos): com a chave `teto_da_meta` ligada (só a
  --     KOMUNE) e a Meta tendo dito o limite do número, o do dia É o dela, e o
  --     da hora cresce junto (o dia inteiro cabe em 8 horas). Sem a chave, ou
  --     sem notícia da Meta, é o de antes, palavra por palavra: 150/dia e
  --     60/hora de app_settings, o do dia limitado pelo da Meta.
  select s.value into v_cfg from public.app_settings s where s.key = 'whatsapp.envio';
  if v_meta_dia is not null and coalesce((v_cfg ->> 'teto_da_meta')::boolean, false) then
    v_td := v_meta_dia;
    v_th := greatest(coalesce((v_cfg ->> 'teto_iniciadas_hora')::int, 60),
                     ceil(v_meta_dia / 8.0)::int);
  else
    v_td := least(coalesce((v_cfg ->> 'teto_iniciadas_dia')::int, 150),
                  coalesce(v_meta_dia, 2147483647));
    v_th := coalesce((v_cfg ->> 'teto_iniciadas_hora')::int, 60);
  end if;
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
end $function$;

comment on function app.pode_enviar(uuid, boolean, boolean, timestamptz) is
  'A porteira do envio: supressão → o que a Meta decidiu sobre a conta → janela de 24 h → template obrigatório fora dela → janela de horário do RF-CON-11 → restrição de saída → teto de ABERTURAS (app.teto_do_canal) → tetos de volume do dia e da hora. Desde 12/11/2026 (Disparos), com whatsapp.envio.teto_da_meta ligada (só a KOMUNE) e a Meta tendo dito o limite do número, o do dia é o dela e o da hora cresce para o dia caber em 8 horas; sem a chave, os 150/60 de app_settings, como antes.';

-- ---------------------------------------------------------------------
-- 3. O que a tela e o log dizem quando o teto segura
-- ---------------------------------------------------------------------
-- Os números saíram da frase: o teto agora é o da Meta, e muda com o tier.
create or replace function app.wa_motivo_legivel(p_motivo text, p_quando timestamptz default null)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_motivo
           when 'janela_fora_de_hora'  then 'Fora da janela de envio (RF-CON-11).'
           when 'janela_domingo'       then 'Domingo: nenhuma mensagem sai (RF-CON-11).'
           when 'janela_feriado'       then 'Feriado: nenhuma mensagem sai (RF-CON-11).'
           when 'janela_fechada'       then 'Fora da janela de envio (RF-CON-11).'
           when 'teto_do_numero'       then 'Limite de conversas abertas no dia atingido neste número: o da Meta, ou o do aquecimento num número novo (RF-CON-10).'
           when 'teto_iniciadas_dia'   then 'Limite de mensagens iniciadas pela empresa no dia atingido (RF-CON-10).'
           when 'teto_iniciadas_hora'  then 'Limite de mensagens iniciadas pela empresa na hora atingido (RF-CON-10).'
           when 'sem_janela_e_sem_template'
             then 'Fora da janela de 24 h e sem modelo aprovado: a Meta só aceita template para iniciar conversa (R04 §2.1).'
           else coalesce(p_motivo, 'aguardando')
         end
      || case when p_quando is null then ''
              else ' Próxima tentativa a partir de ' ||
                   to_char(p_quando at time zone 'America/Fortaleza', 'DD/MM HH24:MI') || '.'
         end
$$;

-- ---------------------------------------------------------------------
-- 4. O ritmo do disparo: até 300 por hora
-- ---------------------------------------------------------------------
alter table public.envios_em_massa drop constraint if exists envios_em_massa_por_hora_check;
alter table public.envios_em_massa
  add constraint envios_em_massa_por_hora_check check (por_hora between 1 and 300);

-- Criar (definição viva de 20260921110000, com UMA troca, marcada com NOVO).
CREATE OR REPLACE FUNCTION public.envio_em_massa_criar(p_config jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  -- NOVO (12/11/2026, Disparos): até 300 por hora; quem segura é o limite da Meta.
  if v_hora not between 1 and 300 then
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
end $function$;

-- O relógio (definição viva de 20261002200000; as trocas estão marcadas com NOVO).
CREATE OR REPLACE FUNCTION app.envios_em_massa_rodar()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  -- NOVO (12/11/2026, Disparos): o ritmo acima de 60 por hora.
  v_rapido boolean;
  v_prox   timestamptz;
  v_lote   int;
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
    -- NOVO (12/11/2026, Disparos): acima de 60 por hora o passo é menor que a
    -- volta do relógio (1 min), e uma mensagem por volta seguraria o disparo em
    -- 60/h. A volta passa a mandar quantas couberem, contando o passo a partir
    -- de onde a anterior parou — e nunca de mais de 1 min atrás, para não
    -- despejar de uma vez o atraso de uma espera. Até 60 por hora, nada muda:
    -- uma por volta, como sempre.
    v_rapido := v_passo < interval '1 minute';
    v_prox   := greatest(e.proximo_em, now() - interval '1 minute');
    v_lote   := 0;
    v_tent := 0;
    loop
      v_tent := v_tent + 1;
      -- Até 20 pulos por volta (os enviados não contam como pulo); o resto na próxima.
      exit when v_tent > 20 + v_lote;

      select * into it from public.envios_em_massa_itens
       where envio_id = e.id and status = 'pendente'
       order by posicao limit 1
       for update skip locked;
      if not found then
        -- A FILA VAZIA. Lote comum acabou; lote contínuo só está em dia — quem
        -- for aprovado no Radar daqui a uma hora entra nela. Concluí-lo seria
        -- obrigar alguém a criar um lote novo a cada aprovação, que é
        -- exatamente o trabalho que este arquivo veio tirar da frente.
        if e.continuo then
          update public.envios_em_massa
             set status = 'agendado', atualizado_em = now(),
                 proximo_em = now() + interval '10 minutes'
           where id = e.id;
        else
          update public.envios_em_massa
             set status = 'concluido', concluido_em = now(), atualizado_em = now()
           where id = e.id;
        end if;
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
        v_prox := (case when v_rapido then v_prox else now() end)
                  + v_passo * (0.7 + random() * 0.6);
        update public.envios_em_massa
           set status = 'enviando', atualizado_em = now(),
               proximo_em = greatest(v_prox, now())
         where id = e.id;
        v_feitos := v_feitos + 1;
        v_lote := v_lote + 1;
        -- NOVO: no ritmo rápido, a próxima ainda cabe nesta volta? (no máximo 20)
        exit when not v_rapido or v_prox > now() or v_lote >= 20;
        continue;
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
end $function$;

-- ---------------------------------------------------------------------
-- 5. A cota de hoje, para o topo da tela
-- ---------------------------------------------------------------------
create or replace function public.envio_em_massa_teto()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_dia    date := (now() at time zone 'America/Fortaleza')::date;
  v_numero text := app.wa_numero_padrao();
  v_meta   jsonb;
  v_nosso  int;
  v_dela   int;
  v_teto   int;
  v_usados int;
begin
  -- DEVOLVE, não levanta: a tela de /envios conta com isso desde 21/09.
  if auth.uid() is null or not app.is_manager() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  v_meta   := app.wa_teto_da_meta(v_numero, now());
  v_nosso  := app.teto_do_canal('whatsapp'::app.channel, v_dia);
  v_dela   := (v_meta ->> 'teto_dia')::int;
  v_teto   := least(v_nosso, coalesce(v_dela, 2147483647));
  v_usados := app.aberturas_do_dia('whatsapp'::app.channel, v_dia, v_numero);
  return jsonb_build_object(
    'ok', true,
    'teto', v_teto,
    'teto_nosso', v_nosso,
    'teto_da_meta', v_dela,
    'tier', v_meta ->> 'tier',
    'qualidade', v_meta ->> 'qualidade',
    -- Passado o aquecimento, o nosso É o dela: empate quer dizer "da Meta".
    'quem_manda', case when v_dela is not null and v_dela <= v_nosso then 'meta' else 'nos' end,
    'usados', v_usados,
    'sobra', greatest(v_teto - v_usados, 0),
    -- O que os disparos em curso ainda vão mandar (o bom-dia contínuo fora:
    -- ele não tem fim, e contá-lo faria a sobra parecer menor do que é).
    'na_fila', (select count(*)::int
                  from public.envios_em_massa_itens i
                  join public.envios_em_massa e on e.id = i.envio_id
                 where i.status = 'pendente' and not e.continuo
                   and e.status in ('agendado', 'enviando')));
end $$;
comment on function public.envio_em_massa_teto() is
  'A cota de hoje para a tela de Disparos (/envios): o teto que vale (o menor entre o nosso e o da Meta — com a chave teto_da_meta ligada, passado o aquecimento, o nosso é o dela), o tier e a nota do número, quantas conversas a empresa já abriu hoje (como a Meta conta), quanto sobra e quantas mensagens os disparos em curso ainda vão mandar.';

-- ---------------------------------------------------------------------
-- 6. Só na KOMUNE: liga a chave e encurta o intervalo do worker-wa
-- ---------------------------------------------------------------------
-- 45–180 s (média de 112 s) entre mensagens iniciadas pela empresa dá ≈ 32 por
-- hora: 2.000 não cabem. 8–24 s (média de 16 s) dá ≈ 225 por hora, e as 2.000
-- cabem nas 9 h 45 da janela. O intervalo só muda onde ainda é o padrão: quem
-- ajustou à mão decidiu, e fica. Na Imova (e em banco sem identidade, como o
-- local), nada disto roda.
do $komune$
begin
  if coalesce((select i.empresa from app.identidade i limit 1), '') <> 'komune' then
    raise notice 'Disparos: banco que não é da KOMUNE; a chave teto_da_meta fica desligada.';
    return;
  end if;
  update public.app_settings
     set value = value || '{"teto_da_meta": true}'::jsonb
   where key = 'whatsapp.envio';
  update public.app_settings
     set value = value || '{"intervalo_min_seg": 8, "intervalo_max_seg": 24}'::jsonb
   where key = 'whatsapp.envio'
     and coalesce((value ->> 'intervalo_min_seg')::int, 45) = 45
     and coalesce((value ->> 'intervalo_max_seg')::int, 180) = 180;
end
$komune$;

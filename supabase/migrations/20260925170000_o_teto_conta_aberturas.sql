-- =====================================================================
-- O aquecimento passa a contar ABERTURA, e o recontato deixa de passar por baixo
-- =====================================================================
-- O FURO. `app.messages_deriva_primeiro_contato` (20260914100000:132) só marca
-- `is_first_contact` quando a conversa nunca teve entrada nem saída viva. E
-- `app.pode_enviar` consulta o aquecimento DENTRO de `if p_primeiro_contato`.
-- Logo: uma campanha de recontato sobre 3.000 fichas já tocadas pula o passo 5
-- inteiro e só esbarra em 150/dia e 60/hora. Ninguém mentiu — o aquecimento
-- simplesmente não era perguntado.
--
-- A META NÃO CONTA "PRIMEIRO CONTATO". Ela conta conversa ABERTA PELA EMPRESA,
-- e cobra por isso. O número que a nossa porteira compara com o aquecimento
-- tem de ser o mesmo número que a Meta olha, ou o aquecimento está medindo
-- outra coisa.
--
-- O `if` SOME, e não é substituído por outro. Seria tautológico: o passo 2 já
-- retornou `true` para todo caso de `not p_primeiro_contato` com janela aberta.
-- O que chega ao passo 5 é, por construção, mensagem iniciada pela empresa.
--
-- `is_first_contact` CONTINUA COM O MESMO SIGNIFICADO. Muda o que o PORTÃO
-- conta, não o que a coluna quer dizer: "quantas fichas novas tocamos hoje"
-- continua sendo pergunta de relatório, e `app.primeiros_contatos_do_dia`
-- continua sendo a resposta.
--
-- OS DOIS PORTÕES CONTAM JUNTOS. `app.toques_do_dia` é o que a CADÊNCIA
-- pergunta (app.pode_tocar passo 6 em 20260904001700:577, o motor de recontato
-- em 20260905000801:427 e a tela em 20260904001890:152). Ele já era apelido de
-- `app.primeiros_contatos_do_dia`; passa a ser apelido de
-- `app.aberturas_do_dia`. Deixar um em cada denominador faria a cadência
-- AGENDAR o que a porteira recusa — e o excedente atrasado sem nunca caber é
-- uma fila que só cresce.
--
-- O PREÇO, DITO CLARO: a campanha de recontato passa a andar a 45/dia em vez
-- de 150/dia. 3.000 fichas deixam de levar 20 dias úteis e passam a levar 67. E
-- o teto agora é do time inteiro: um dia de follow-ups legítimos fora da janela
-- come a mesma cota — que é como a Meta conta. Subir é `update` do gestor em
-- `app_settings.cadencia.tetos.whatsapp.depois`, com `teto_duro` de 100 já
-- validado por `app.app_settings_validate`. Recomendação escrita: só depois de
-- duas semanas com `qualidade = 'GREEN'` em `public.wa_saude_numero`.
--
-- NENHUM LOTE MORRE. `teto_do_numero` já é espera em
-- `app.envio_motivo_de_espera`, e `app.envios_em_massa_rodar` adormece o envio
-- com `proximo_em` na próxima abertura em vez de pular o item.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Aberturas do dia
-- ---------------------------------------------------------------------
-- Cópia de `app.primeiros_contatos_do_dia` com duas diferenças:
--   `m.is_first_contact` → `m.business_initiated`, que é o que a Meta conta;
--   `and not m.optout_confirmation`, porque a confirmação de opt-out É
--   `business_initiated` fora da janela, mas é resposta a quem pediu para
--   sair — nunca abertura. E o portão dela (20260905000300:216) não consulta
--   `app.teto_do_canal`: ela não pode ser barrada pelo aquecimento, logo
--   também não pode comê-lo.
create or replace function app.aberturas_do_dia(p_channel app.channel,
                                                p_dia     date,
                                                p_numero  text default null)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select (
    -- (a) os toques de cadência agendados ou feitos no dia
    select count(*)::int
      from public.cadence_touches t
     where t.channel = p_channel
       and t.status in ('pendente'::app.touch_status, 'feito'::app.touch_status)
       and (t.due_at at time zone 'America/Fortaleza')::date = p_dia
  ) + (
    -- (b) tudo o que a EMPRESA começou fora da cadência — primeiro contato,
    --     recontato e campanha, que para a Meta são a mesma coisa
    select count(*)::int
      from public.messages m
      join public.conversations c on c.id = m.conversation_id
     where m.direction = 'out'::app.msg_direction
       and m.business_initiated
       and not m.optout_confirmation
       and m.cadence_touch_id is null
       and m.status <> 'failed'::app.msg_status
       and c.channel = p_channel
       and (p_numero is null or c.business_number = p_numero)
       and (coalesce(m.sent_at, m.created_at) at time zone 'America/Fortaleza')::date = p_dia
  )
$$;
comment on function app.aberturas_do_dia(app.channel, date, text) is
  'Quantas CONVERSAS a empresa abriu naquele canal (e número) no dia: toques de cadência mais toda saída business_initiated fora da cadência — primeiro contato, recontato e campanha, que para a Meta são a mesma coisa. A confirmação de opt-out não conta: ela é resposta a quem pediu para sair, e o portão dela nem consulta o aquecimento. Desde 25/09/2026 é este o número que o teto do RF-CON-10 compara.';
revoke all on function app.aberturas_do_dia(app.channel, date, text) from public, anon;
grant execute on function app.aberturas_do_dia(app.channel, date, text) to authenticated, service_role;

-- O apelido que a cadência inteira já chama passa a apontar para cá: os dois
-- portões contam a mesma coisa, ou não são um teto.
create or replace function app.toques_do_dia(p_channel app.channel, p_dia date)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select app.aberturas_do_dia(p_channel, p_dia, null)
$$;
comment on function app.toques_do_dia(app.channel, date) is
  'Consumo do teto diário do canal (RF-CON-10). Desde 25/09/2026 delega para app.aberturas_do_dia: a cadência e a porteira do envio contam a mesma coisa, que é o que a Meta conta — conversa aberta pela empresa, e não "primeiro contato". Dois tetos com denominadores diferentes não são um teto.';

-- `app.primeiros_contatos_do_dia` FICA DE PÉ, sem mudar: é ela que responde
-- "quantas fichas novas tocamos hoje", que é pergunta de relatório e continua
-- sendo medida pelo arquivo 24.

-- ---------------------------------------------------------------------
-- 2. O índice segue o que passou a ser contado
-- ---------------------------------------------------------------------
-- `messages_teto_idx` era parcial por `is_first_contact` e deixa de servir. O
-- novo serve também `app.iniciadas_pela_empresa`, que até hoje varria sem
-- índice nenhum.
create index if not exists messages_aberturas_idx on public.messages (created_at)
  where direction = 'out'::app.msg_direction and business_initiated;
drop index if exists public.messages_teto_idx;

-- ---------------------------------------------------------------------
-- 3. A porteira, sem o `if`
-- ---------------------------------------------------------------------
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
  'A porteira do envio: supressão → o que a Meta decidiu sobre a conta → janela de 24 h → template obrigatório fora dela → janela de horário do RF-CON-11 → restrição de saída → teto de ABERTURAS (o menor entre o aquecimento e o da Meta), sem exceção para recontato → tetos de 150/dia e 60/hora. Desde 25/09/2026 o passo 5 conta app.aberturas_do_dia, e não primeiros contatos: a Meta conta conversa aberta pela empresa, e o aquecimento tem de medir a mesma coisa.';

-- ---------------------------------------------------------------------
-- 4. A tela de /envios diz de quem é o teto
-- ---------------------------------------------------------------------
-- Com o ritmo caindo de 150 para 45 de um dia para o outro, quem estiver com
-- lote grande em curso vê o "termina em" triplicar. Sem dizer de quem é o teto
-- e por quê, isso parece bug.
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
begin
  -- DEVOLVE, não levanta: a tela de /envios conta com isso desde 21/09.
  if auth.uid() is null or not app.is_manager() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  v_meta  := app.wa_teto_da_meta(v_numero, now());
  v_nosso := app.teto_do_canal('whatsapp'::app.channel, v_dia);
  v_dela  := (v_meta ->> 'teto_dia')::int;
  return jsonb_build_object(
    'ok', true,
    'teto', least(v_nosso, coalesce(v_dela, 2147483647)),
    'teto_nosso', v_nosso,
    'teto_da_meta', v_dela,
    'qualidade', v_meta ->> 'qualidade',
    'quem_manda', case when v_dela is not null and v_dela < v_nosso then 'meta' else 'nos' end,
    'usados', app.aberturas_do_dia('whatsapp'::app.channel, v_dia, v_numero));
end $$;
comment on function public.envio_em_massa_teto() is
  'O teto de aberturas de hoje para a tela de /envios: o nosso (aquecimento), o da Meta, qual dos dois manda, a nota do número e quantas aberturas já foram gastas. "Aberturas", e não "primeiros contatos": recontato e campanha contam igual, que é como a Meta conta.';
revoke all on function public.envio_em_massa_teto() from public, anon;
grant execute on function public.envio_em_massa_teto() to authenticated;


-- ---------------------------------------------------------------------
-- 5. A prévia da ficha mede o MESMO que a porteira
-- ---------------------------------------------------------------------
-- `public.wa_preparar_envio` (versão viva: 20260917200100) tinha o mesmo `if
-- v_primeiro` do passo 5, e com ele um terceiro denominador. Deixá-lo assim
-- faria a tela da ficha oferecer o botão que `app.pode_enviar` recusa um
-- segundo depois — e "clique que dá erro" é pior que botão desabilitado com
-- motivo. A função é copiada do banco com `pg_get_functiondef` e recebe UMA
-- mudança: o ramo do teto. São 137 linhas de guardrails (supressão, janela de
-- 24 h, recusa de modelo de sistema, pseudonimização); reescrevê-las de
-- memória seria perder uma delas sem perceber.
CREATE OR REPLACE FUNCTION public.wa_preparar_envio(p_organization_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  o            public.organizations%rowtype;
  v_numero     text := app.wa_numero_padrao();
  v_tel        text;
  v_ct         uuid;
  v_nome       text;
  v_conv       uuid;
  v_janela24   boolean := false;
  v_primeiro   boolean := true;
  v_ultima     timestamptz;
  v_motivo     text;
  v_quando     timestamptz;
  v_respondeu  boolean;
  v_canal      jsonb;
  v_dia        date := (now() at time zone 'America/Fortaleza')::date;
  v_teto       int;
  v_usados     int;
  v_origem     text;
  v_categoria  text;
  v_segmento   text;
begin
  if auth.uid() is null or not app.can_write() then
    raise exception 'Sem permissão para enviar mensagem pelo WhatsApp' using errcode = '42501';
  end if;
  select * into o from public.organizations
   where id = p_organization_id and deleted_at is null;
  if not found or not app.org_is_visible(o.id) then
    raise exception 'Ficha não encontrada' using errcode = 'P0002';
  end if;

  select d.telefone, d.contact_id, d.primeiro_nome into v_tel, v_ct, v_nome
    from app.wa_destino_da_ficha(o.id) d;

  if v_numero is not null and v_tel is not null then
    select c.id into v_conv from public.conversations c
     where c.channel = 'whatsapp'::app.channel
       and c.business_number = v_numero
       and c.peer_phone_e164 = v_tel;
  end if;
  if v_conv is not null then
    v_janela24 := app.janela_de_24h_aberta(v_conv, now());
    -- A última mensagem nossa que não falhou e que a pessoa ainda não respondeu.
    -- É o que impede a tela de oferecer a segunda abertura um minuto depois da
    -- primeira: duas mensagens frias seguidas são o bloqueio que derruba a
    -- qualidade do número na Meta (R04 §2.1).
    select max(coalesce(m.sent_at, m.created_at)) into v_ultima
      from public.messages m join public.conversations c on c.id = m.conversation_id
     where m.conversation_id = v_conv
       and m.direction = 'out'::app.msg_direction
       and m.status <> 'failed'::app.msg_status
       and (c.last_inbound_at is null or coalesce(m.sent_at, m.created_at) > c.last_inbound_at);
    v_primeiro := not exists (select 1 from public.conversations c
                               where c.id = v_conv and c.last_inbound_at is not null)
                  and not exists (select 1 from public.messages m
                                   where m.conversation_id = v_conv
                                     and (m.direction = 'in'::app.msg_direction
                                          or m.status <> 'failed'::app.msg_status));
  end if;

  -- O que barraria o envio agora, na ordem de app.pode_enviar.
  if v_numero is null then
    v_motivo := 'whatsapp_nao_configurado';
  elsif v_tel is null then
    v_motivo := 'ficha_sem_whatsapp';
  else
    v_motivo := app.wa_motivo_de_recusa(o.id, v_ct, v_tel);
  end if;
  if v_motivo is null and not v_janela24 then
    v_respondeu := app.ja_respondeu(o.id);
    v_canal := app.janela_do_canal('whatsapp'::app.channel, now(), v_respondeu);
    if not coalesce((v_canal ->> 'aberta')::boolean, false) then
      v_motivo := 'janela_' || coalesce(v_canal ->> 'motivo', 'fechada');
      v_quando := (v_canal ->> 'abre_em')::timestamptz;
    else
      -- SEM `elsif v_primeiro`, desde 25/09/2026: a prévia tem de medir o mesmo
      -- que `app.pode_enviar` mede, ou a tela oferece o botão que a porteira
      -- vai recusar. Este ramo só é alcançado quando NÃO há janela de 24 h
      -- aberta (o `if` de fora), logo é sempre conversa que a empresa está
      -- abrindo — recontato inclusive, que é como a Meta conta.
      v_teto   := least(app.teto_do_canal('whatsapp'::app.channel, v_dia),
                        coalesce((app.wa_teto_da_meta(v_numero, now()) ->> 'teto_dia')::int,
                                 2147483647));
      v_usados := app.aberturas_do_dia('whatsapp'::app.channel, v_dia, v_numero);
      if v_usados >= v_teto then
        v_motivo := 'teto_do_numero';
        v_quando := app.proxima_abertura_do_canal(v_dia, 'whatsapp'::app.channel, v_respondeu);
      end if;
    end if;
  end if;

  -- Sugestões de preenchimento. `origem` só quando a fonte é um lugar público
  -- que a pessoa reconheceria ("vi seu contato no Google Maps"); "Planilha
  -- (importação)" numa abertura é pior do que um campo vazio.
  select s.name into v_origem from public.sources s
   where s.id = o.source_id and s.kind in ('scrape'::app.source_kind, 'api'::app.source_kind);
  select lower(c.name) into v_categoria
    from public.organization_categories oc join public.categories c on c.id = oc.category_id
   where oc.organization_id = o.id
   order by oc.is_primary desc, oc.created_at limit 1;
  v_segmento := app.segmento_da_ficha(o.id);

  return jsonb_build_object(
    'numero_configurado', v_numero is not null,
    'tem_whatsapp',       v_tel is not null,
    'conversa_id',        v_conv,
    'janela_24h_aberta',  v_janela24,
    'primeiro_contato',   v_primeiro,
    'sem_resposta_desde', v_ultima,
    'bloqueio',           case when v_motivo is null then null
                               else jsonb_build_object('motivo', v_motivo, 'quando', v_quando) end,
    'teto',               case when v_teto is null then null
                               else jsonb_build_object('usados', v_usados, 'teto', v_teto) end,
    'segmento',           v_segmento,
    'valores',            jsonb_strip_nulls(jsonb_build_object(
                            'nome', v_nome, 'empresa', o.name,
                            'origem', v_origem, 'categoria', v_categoria,
                            'atendente', app.primeiro_nome(auth.uid()),
                            'saudacao', app.saudacao_do_momento())),
    'modelos',            coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', t.id, 'codigo', t.template_code, 'nome', t.name,
               'tipo', t.kind, 'variante', t.variant, 'segmento', t.segment,
               'corpo', t.body, 'variaveis', to_jsonb(app.modelo_variaveis(t.body)))
             order by (t.segment = v_segmento) desc nulls last,
                      case t.kind when 'abertura' then 0 when 'followup' then 1 else 2 end,
                      t.template_code)
        from public.message_templates t
       where t.is_active
         and t.channel = 'whatsapp'::app.channel
         and t.template_code not like 'GEN-SYS-%'
         and t.meta_status = 'approved'
         and nullif(btrim(coalesce(t.meta_template_name, '')), '') is not null), '[]'::jsonb),
    'modelos_esperando_meta', (
      select count(*)::int from public.message_templates t
       where t.is_active and t.channel = 'whatsapp'::app.channel
         and t.category in ('marketing', 'utility')
         and t.meta_status is distinct from 'approved'));
end $function$;
comment on function public.wa_preparar_envio(uuid) is
  'A prévia do envio pela ficha: o que preencher, o que barraria e por quê. Desde 25/09/2026 o teto que ela mostra é o de ABERTURAS (app.aberturas_do_dia), limitado também pelo da Meta — o mesmo que app.pode_enviar mede, para a tela não oferecer o botão que a porteira recusa.';
revoke all on function public.wa_preparar_envio(uuid) from public, anon;
grant execute on function public.wa_preparar_envio(uuid) to authenticated;

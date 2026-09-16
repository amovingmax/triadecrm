-- =====================================================================
-- CRM Inteligente, Fase 2 (parte 1): o worker ganha as duas pontas
--
-- A Fase 1 deixou a mesa posta — tabelas, fila, debounce, prompts. Faltavam as
-- duas pontas que fazem a análise acontecer, e as duas são do banco, não do
-- worker (ADR-03):
--
--   A. `app.ia_entrada_da_ficha`  — tudo o que o prompt precisa ler, numa consulta
--      só: etapa, etapas válidas, responsável, temperatura, ficha anterior,
--      compromissos em aberto, as mensagens NOVAS e o que o CRM ainda não sabe.
--   B. `app.ia_gravar_ficha`      — o que o modelo devolveu, gravado numa transação
--      só, com a evidência conferida contra as mensagens da própria conversa.
--
-- O worker fica fino de propósito: ele chama A, chama o modelo, chama B. Regra
-- nenhuma mora nele.
--
-- =====================================================================
-- O QUE B RECUSA — e é por isso que ela existe
-- =====================================================================
--   · **Evidência que não existe.** Sinal, compromisso, cumprimento ou dado
--     extraído que aponte para mensagem que não é DESTA conversa é descartado, e
--     a contagem do que caiu volta para quem chamou. O modelo não inventa prova.
--   · **Etapa.** `etapaSugerida` é gravada como sugestão e nada mais: quem move o
--     negócio é gente (ADR-05).
--   · **Campo preenchido por pessoa.** Sugestão de campo só nasce para campo VAZIO,
--     e mesmo assim nasce `pendente` — ninguém aplica nada sozinho. Com a bandeira
--     `sugestoes_de_campo` desligada, nem nascem.
--   · **Prazo que não é data.** "sexta que vem" não vira timestamp chutado: vira
--     null, e o compromisso continua existindo com o texto do que foi prometido.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Dois ajudantes pequenos
-- ---------------------------------------------------------------------
create or replace function app.ia_uuid(p_texto text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_texto is null then return null; end if;
  return p_texto::uuid;
exception when others then
  -- O modelo devolveu algo que não é id nosso. Não é erro da esteira: é evidência
  -- que não prova nada, e quem chamou conta quantas caíram.
  return null;
end $$;
comment on function app.ia_uuid(text) is
  'Texto → uuid, ou null quando não for um. Evidência com id inválido é descartada, não explode a fila.';
revoke all on function app.ia_uuid(text) from public, anon, authenticated;

create or replace function app.ia_campo_vazio(p_org uuid, p_campo text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case p_campo
    when 'bairro'        then (select o.neighborhood is null     from public.organizations o where o.id = p_org)
    when 'instagram'     then (select o.instagram_handle is null from public.organizations o where o.id = p_org)
    when 'email'         then (select o.email is null            from public.organizations o where o.id = p_org)
    when 'site'          then (select o.website is null          from public.organizations o where o.id = p_org)
    when 'telefone_fixo' then (select o.phone_e164 is null       from public.organizations o where o.id = p_org)
    -- Campo que a tela não sabe mostrar não vira sugestão: sugestão que ninguém
    -- consegue aceitar é fila morta.
    else false
  end
$$;
create or replace function app.ia_mensagem_da_conversa(p_message uuid, p_conversation uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_message is not null and exists (
    select 1 from public.messages m
     where m.id = p_message and m.conversation_id = p_conversation
  )
$$;
comment on function app.ia_mensagem_da_conversa(uuid, uuid) is
  'A conferência da evidência: o message_id que o modelo citou é mesmo desta conversa? Sem isto, um id inventado (ou o de outra conversa) viraria prova.';
revoke all on function app.ia_mensagem_da_conversa(uuid, uuid) from public, anon, authenticated;

comment on function app.ia_campo_vazio(uuid, text) is
  'A lista branca dos campos que a IA pode sugerir, e a conferência de que o campo está VAZIO. Fora da lista, ninguém sugere nada.';
revoke all on function app.ia_campo_vazio(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- A. A entrada da ficha
-- ---------------------------------------------------------------------
create or replace function app.ia_entrada_da_ficha(p_conversation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_conversa  public.conversations%rowtype;
  v_deal      public.deals%rowtype;
  v_org       public.organizations%rowtype;
  v_ficha     public.ficha_da_conversa%rowtype;
  v_desde     timestamptz;
  v_desde_id  uuid;
  v_teto      int;
  v_msgs      jsonb;
begin
  select * into v_conversa from public.conversations where id = p_conversation_id;
  if not found then
    return jsonb_build_object('existe', false);
  end if;

  select * into v_ficha from public.ficha_da_conversa where conversation_id = p_conversation_id;
  if v_conversa.deal_id is not null then
    select * into v_deal from public.deals where id = v_conversa.deal_id;
  end if;
  if v_conversa.organization_id is not null then
    select * into v_org from public.organizations where id = v_conversa.organization_id;
  end if;

  -- A janela: só o que chegou depois da última análise. Sem ficha, a conversa
  -- inteira — que é a primeira análise, e é a única vez que ela sai cara.
  --
  -- O corte é o PAR (data, id) da última mensagem lida, e não a data sozinha:
  -- duas mensagens no mesmo instante são o caso comum aqui (a que chega e a
  -- resposta do bot nascem na mesma transação, onde `now()` não anda), e com o
  -- corte por data uma delas nunca seria analisada.
  v_desde    := v_ficha.analisada_em;
  v_desde_id := v_ficha.ultima_mensagem_analisada;
  v_teto     := 60;

  -- As mais RECENTES, até o teto, devolvidas em ordem de conversa. Cortar pelo
  -- começo seria analisar o passado e ignorar o que acabou de ser dito.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m.id, 'de', m.de, 'quando', m.quando, 'texto', m.texto)
         order by m.created_at, m.id), '[]'::jsonb)
    into v_msgs
    from (
      select msg.id,
             -- Quem falou, no vocabulário do prompt. O robô assina diferente de
             -- gente porque cortesia de robô não é sinal de interesse.
             case
               when msg.direction = 'in' then 'parceiro'
               when msg.author_kind = 'bot' then 'robo'
               else 'equipe'
             end as de,
             to_char(msg.created_at at time zone 'America/Fortaleza', 'DD/MM HH24:MI') as quando,
             left(coalesce(msg.body, msg.transcript), 4000) as texto,
             msg.created_at
        from public.messages msg
       where msg.conversation_id = p_conversation_id
         and coalesce(msg.body, msg.transcript) is not null
         and (v_desde is null
              or (msg.created_at, msg.id) > (v_desde, coalesce(v_desde_id, '00000000-0000-0000-0000-000000000000'::uuid)))
       order by msg.created_at desc, msg.id desc
       limit v_teto
    ) m;

  return jsonb_build_object(
    'existe', true,
    'conversation_id', v_conversa.id,
    'organization_id', v_conversa.organization_id,
    'contact_id',      v_conversa.contact_id,
    'deal_id',         v_conversa.deal_id,
    -- Fuso do CRM inteiro (America/Fortaleza): é com este "agora" que o modelo
    -- transforma "amanhã" em data e julga o que é recente.
    'agora', to_char(now() at time zone 'America/Fortaleza', 'YYYY-MM-DD HH24:MI'),
    'etapa', (select s.name from public.stages s where s.id = v_deal.stage_id),
    'etapas_validas', coalesce((
      select jsonb_agg(s.name order by s.position)
        from public.stages s
       where s.pipeline_id = v_deal.pipeline_id
         and not s.is_terminal
    ), '[]'::jsonb),
    'responsavel', (
      select split_part(coalesce(p.full_name, ''), ' ', 1)
        from public.profiles p where p.id = v_conversa.assignee_id
    ),
    'temperatura', coalesce(v_deal.temperature::text, v_org.temperature::text),
    'ultima_intencao', v_conversa.ai_intent,
    'ficha_anterior', v_ficha.resumo,
    'analisada_em', v_desde,
    'compromissos_abertos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id, 'o_que', c.o_que,
               'prazo', to_char(c.prazo at time zone 'America/Fortaleza', 'DD/MM HH24:MI'))
             order by c.created_at)
        from public.compromissos_da_conversa c
       where c.conversation_id = p_conversation_id and c.status = 'aberto'
    ), '[]'::jsonb),
    'mensagens', v_msgs,
    -- Até onde esta janela leu. O worker devolve este id na gravação, e é ele
    -- que fecha a janela — não `now()`, que esconderia o que chegou durante a
    -- chamada ao modelo.
    'ate_message_id', v_msgs -> -1 ->> 'id',
    -- O que o CRM ainda não sabe é o que vale a pena procurar na conversa.
    'campos_vazios', coalesce((
      select jsonb_agg(campo) from (
        select 'bairro' as campo where v_org.id is not null and v_org.neighborhood is null
        union all select 'instagram' where v_org.id is not null and v_org.instagram_handle is null
        union all select 'email'     where v_org.id is not null and v_org.email is null
        union all select 'site'      where v_org.id is not null and v_org.website is null
        union all select 'telefone_fixo' where v_org.id is not null and v_org.phone_e164 is null
      ) c
    ), '[]'::jsonb)
  );
end $$;

comment on function app.ia_entrada_da_ficha(uuid) is
  'Tudo o que ficha-da-conversa@v1 precisa ler, numa consulta só: a janela de mensagens novas (ou a conversa inteira, na primeira análise), a ficha anterior, os compromissos em aberto e o que o CRM ainda não sabe. Quem monta a entrada é o banco; o worker só a entrega ao modelo.';
revoke all on function app.ia_entrada_da_ficha(uuid) from public, anon, authenticated;
-- A porta pública é `security invoker`: quem chama precisa de EXECUTE aqui também.
grant execute on function app.ia_entrada_da_ficha(uuid) to service_role;

create or replace function public.ia_entrada_da_ficha(p_conversation_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select app.ia_entrada_da_ficha(p_conversation_id)
$$;
comment on function public.ia_entrada_da_ficha(uuid) is
  'Porta do worker de IA (service_role) para app.ia_entrada_da_ficha.';
revoke all on function public.ia_entrada_da_ficha(uuid) from public, anon, authenticated;
-- O worker de IA é quem chama, e ele entra como service_role.
grant execute on function public.ia_entrada_da_ficha(uuid) to service_role;

-- ---------------------------------------------------------------------
-- Um prazo que não é data não vira data chutada
-- ---------------------------------------------------------------------
create or replace function app.ia_prazo(p_texto text)
returns timestamptz
language plpgsql
immutable
set search_path = ''
as $$
declare v_quando timestamptz;
begin
  if p_texto is null or btrim(p_texto) = '' then
    return null;
  end if;
  -- Só data escrita como data. "sexta que vem" é informação do texto do
  -- compromisso, não um timestamp que alguém vai cobrar no Pulso do dia.
  if p_texto !~ '^\d{4}-\d{2}-\d{2}' then
    return null;
  end if;
  begin
    v_quando := p_texto::timestamptz;
  exception when others then
    return null;
  end;
  return v_quando;
end $$;
comment on function app.ia_prazo(text) is
  'Converte o prazo devolvido pelo modelo em timestamp SÓ quando ele veio escrito como data (ISO). O resto vira null: prazo chutado viraria cobrança errada no Pulso do dia.';
revoke all on function app.ia_prazo(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- B. A ficha gravada, com a evidência conferida
-- ---------------------------------------------------------------------
create or replace function app.ia_gravar_ficha(
  p_conversation_id uuid,
  p_saida           jsonb,
  p_ai_run_id       bigint default null,
  p_prompt_version  text    default null,
  -- Até onde a análise leu. Vem de `ia_entrada_da_ficha`, e é o que fecha a
  -- janela: fechar com `now()` esconderia a mensagem que chegou enquanto o
  -- modelo pensava, e ela nunca seria analisada.
  p_ate_message_id  uuid    default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conversa public.conversations%rowtype;
  v_ultima   uuid;
  v_ultima_em timestamptz;
  v_tem_novidade boolean;
  v_sinais   jsonb;
  v_dados    jsonb;
  v_novos    int := 0;
  v_cumpridos int := 0;
  v_sugestoes int := 0;
  v_descartados int := 0;
  v_liga_sugestao boolean;
  v_item     jsonb;
  v_msg      uuid;
begin
  select * into v_conversa from public.conversations where id = p_conversation_id;
  if not found then
    raise exception 'conversa % não existe', p_conversation_id using errcode = '22023';
  end if;

  -- Quem fecha a janela é a mensagem que a análise leu. Sem ela (chamada antiga
  -- ou worker que não a informou), vale a última da conversa.
  select m.id, m.created_at into v_ultima, v_ultima_em
    from public.messages m
   where m.conversation_id = p_conversation_id
     and (p_ate_message_id is null or m.id = p_ate_message_id)
   order by m.created_at desc, m.id desc
   limit 1;

  -- ----- os sinais, um a um -----
  v_sinais := '[]'::jsonb;
  for v_item in select * from jsonb_array_elements(coalesce(p_saida -> 'sinais', '[]'::jsonb)) loop
    v_msg := app.ia_uuid(v_item ->> 'messageId');
    if not app.ia_mensagem_da_conversa(v_msg, p_conversation_id) then
      v_descartados := v_descartados + 1;
      continue;
    end if;
    v_sinais := v_sinais || jsonb_build_array(jsonb_build_object(
      'tipo',       v_item ->> 'tipo',
      'polaridade', v_item ->> 'polaridade',
      'forca',      v_item ->> 'forca',
      'message_id', v_msg,
      'trecho',     left(coalesce(v_item ->> 'trecho', ''), 120)
    ));
  end loop;

  -- ----- os dados extraídos -----
  v_dados := '{}'::jsonb;
  for v_item in select * from jsonb_array_elements(coalesce(p_saida -> 'dadosExtraidos', '[]'::jsonb)) loop
    v_msg := app.ia_uuid(v_item ->> 'messageId');
    if not app.ia_mensagem_da_conversa(v_msg, p_conversation_id) then
      v_descartados := v_descartados + 1;
      continue;
    end if;
    v_dados := v_dados || jsonb_build_object(v_item ->> 'campo', jsonb_build_object(
      'valor',      left(coalesce(v_item ->> 'valor', ''), 200),
      'confianca',  (v_item ->> 'confianca')::numeric,
      'message_id', v_msg
    ));
  end loop;

  -- ----- a ficha -----
  insert into public.ficha_da_conversa as f (
    conversation_id, organization_id, resumo, intencao, score_intencao, motivo, sentimento,
    sinais, objecoes, alertas, dados_extraidos, proxima_acao, proxima_acao_em, confianca,
    dados_insuficientes, ultima_mensagem_analisada, analisada_em, analises_incrementais,
    prompt_version, ai_run_id, updated_at
  )
  values (
    p_conversation_id, v_conversa.organization_id,
    left(p_saida ->> 'resumo', 600), p_saida ->> 'intencao',
    (p_saida ->> 'scoreIntencao')::smallint, left(p_saida ->> 'motivo', 280),
    p_saida ->> 'sentimento', v_sinais,
    coalesce((select array_agg(v) from jsonb_array_elements_text(coalesce(p_saida -> 'objecoes', '[]'::jsonb)) as v), '{}'),
    coalesce((select array_agg(v) from jsonb_array_elements_text(coalesce(p_saida -> 'alertas',  '[]'::jsonb)) as v), '{}'),
    v_dados,
    left(p_saida -> 'proximaAcao' ->> 'descricao', 200),
    app.ia_prazo(p_saida -> 'proximaAcao' ->> 'prazo'),
    (p_saida ->> 'confianca')::numeric,
    coalesce((p_saida ->> 'dadosInsuficientes')::boolean, true),
    v_ultima, coalesce(v_ultima_em, now()), 1, p_prompt_version, p_ai_run_id, now()
  )
  on conflict (conversation_id) do update set
    organization_id = excluded.organization_id,
    resumo = excluded.resumo, intencao = excluded.intencao,
    score_intencao = excluded.score_intencao, motivo = excluded.motivo,
    sentimento = excluded.sentimento, sinais = excluded.sinais,
    objecoes = excluded.objecoes, alertas = excluded.alertas,
    dados_extraidos = excluded.dados_extraidos,
    proxima_acao = excluded.proxima_acao, proxima_acao_em = excluded.proxima_acao_em,
    confianca = excluded.confianca, dados_insuficientes = excluded.dados_insuficientes,
    ultima_mensagem_analisada = excluded.ultima_mensagem_analisada,
    analisada_em = excluded.analisada_em,
    analises_incrementais = f.analises_incrementais + 1,
    prompt_version = excluded.prompt_version, ai_run_id = excluded.ai_run_id,
    updated_at = now();

  -- ----- os compromissos novos -----
  for v_item in select * from jsonb_array_elements(coalesce(p_saida -> 'compromissosNovos', '[]'::jsonb)) loop
    v_msg := app.ia_uuid(v_item ->> 'messageId');
    if not app.ia_mensagem_da_conversa(v_msg, p_conversation_id) then
      v_descartados := v_descartados + 1;
      continue;
    end if;
    -- A mesma promessa, achada de novo na análise seguinte, não vira uma segunda
    -- linha: análise incremental relê mensagem que já foi lida.
    if exists (
      select 1 from public.compromissos_da_conversa c
       where c.conversation_id = p_conversation_id
         and c.message_id = v_msg
         and lower(c.o_que) = lower(left(v_item ->> 'oQue', 280))
    ) then
      continue;
    end if;
    insert into public.compromissos_da_conversa
      (conversation_id, organization_id, quem, o_que, prazo, message_id)
    values (p_conversation_id, v_conversa.organization_id,
            case when v_item ->> 'quem' = 'equipe' then 'equipe' else 'parceiro' end,
            left(v_item ->> 'oQue', 280), app.ia_prazo(v_item ->> 'prazo'), v_msg);
    v_novos := v_novos + 1;
  end loop;

  -- ----- os compromissos cumpridos -----
  for v_item in select * from jsonb_array_elements(coalesce(p_saida -> 'compromissosCumpridos', '[]'::jsonb)) loop
    v_msg := app.ia_uuid(v_item ->> 'messageId');
    if not app.ia_mensagem_da_conversa(v_msg, p_conversation_id) then
      v_descartados := v_descartados + 1;
      continue;
    end if;
    update public.compromissos_da_conversa
       set status = 'cumprido', cumprido_message_id = v_msg, cumprido_em = now(), updated_at = now()
     where id = app.ia_uuid(v_item ->> 'id')
       and conversation_id = p_conversation_id
       and status = 'aberto';
    if found then v_cumpridos := v_cumpridos + 1; end if;
  end loop;

  -- ----- as sugestões de campo -----
  select coalesce((value -> 'modulos' ->> 'sugestoes_de_campo')::boolean, false)
    into v_liga_sugestao
    from public.app_settings where key = 'ia.crm_inteligente';

  if coalesce(v_liga_sugestao, false) and v_conversa.organization_id is not null then
    for v_item in select * from jsonb_array_elements(coalesce(p_saida -> 'dadosExtraidos', '[]'::jsonb)) loop
      v_msg := app.ia_uuid(v_item ->> 'messageId');
      continue when v_msg is null;
      -- Só campo que o CRM não sabe, e só o que a tela sabe mostrar. Campo cheio
      -- não vira sugestão nem para conferência: a IA não discute com gente.
      if not app.ia_campo_vazio(v_conversa.organization_id, v_item ->> 'campo') then
        continue;
      end if;
      if exists (
        select 1 from public.sugestoes_de_campo s
         where s.entidade = 'organization' and s.entidade_id = v_conversa.organization_id
           and s.campo = v_item ->> 'campo' and s.status = 'pendente'
      ) then
        continue;
      end if;
      insert into public.sugestoes_de_campo
        (conversation_id, organization_id, entidade, entidade_id, campo, valor, confianca, message_id)
      values (p_conversation_id, v_conversa.organization_id, 'organization',
              v_conversa.organization_id, v_item ->> 'campo',
              left(v_item ->> 'valor', 500),
              least(1, greatest(0, coalesce((v_item ->> 'confianca')::numeric, 0))), v_msg);
      v_sugestoes := v_sugestoes + 1;
    end loop;
  end if;

  -- ----- a conversa sai da fila, se não houver novidade -----
  -- Mensagem que chegou depois do que foi lido mantém a conversa pendente: ela
  -- abre a janela seguinte em vez de morrer entre uma análise e outra.
  select exists (
    select 1 from public.messages m
     where m.conversation_id = p_conversation_id
       and (m.created_at, m.id) > (coalesce(v_ultima_em, now()),
                                   coalesce(v_ultima, '00000000-0000-0000-0000-000000000000'::uuid))
  ) into v_tem_novidade;

  update public.conversations
     set ia_analisada_em = coalesce(v_ultima_em, now()),
         ia_pendente_desde = case when v_tem_novidade then ia_pendente_desde else null end,
         updated_at = now()
   where id = p_conversation_id;

  return jsonb_build_object(
    'gravada', true,
    'compromissos_novos', v_novos,
    'compromissos_cumpridos', v_cumpridos,
    'sugestoes', v_sugestoes,
    'evidencias_descartadas', v_descartados,
    'janela_fechada_em', v_ultima_em,
    'chegou_mensagem_nova', v_tem_novidade
  );
end $$;

comment on function app.ia_gravar_ficha(uuid, jsonb, bigint, text, uuid) is
  'Grava a saída de ficha-da-conversa@v1 numa transação só, conferindo cada evidência contra as mensagens da própria conversa: o que apontar para mensagem que não é desta conversa é descartado e contado. Não move etapa, não escreve em campo de gente e não aplica sugestão nenhuma.';
revoke all on function app.ia_gravar_ficha(uuid, jsonb, bigint, text, uuid) from public, anon, authenticated;
grant execute on function app.ia_gravar_ficha(uuid, jsonb, bigint, text, uuid) to service_role;

create or replace function public.ia_gravar_ficha(
  p_conversation_id uuid, p_saida jsonb, p_ai_run_id bigint default null,
  p_prompt_version text default null, p_ate_message_id uuid default null
)
returns jsonb language sql security invoker set search_path = '' as $$
  select app.ia_gravar_ficha(p_conversation_id, p_saida, p_ai_run_id, p_prompt_version, p_ate_message_id)
$$;
comment on function public.ia_gravar_ficha(uuid, jsonb, bigint, text, uuid) is
  'Porta do worker de IA (service_role) para app.ia_gravar_ficha.';
revoke all on function public.ia_gravar_ficha(uuid, jsonb, bigint, text, uuid) from public, anon, authenticated;
-- O worker de IA é quem chama, e ele entra como service_role.
grant execute on function public.ia_gravar_ficha(uuid, jsonb, bigint, text, uuid) to service_role;

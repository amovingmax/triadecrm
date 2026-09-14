-- =====================================================================
-- O WhatsApp passa a sair do CRM (RF-CON-01, RF-CON-02, RF-CON-05, RF-CON-08,
-- RF-CON-10, RF-CON-11, RF-CON-18; ADR-03, ADR-05, ADR-06; anexo R04 §2.1)
-- =====================================================================
--
-- Decisão de 14/09/2026 (Matheus): o número da KOMUNE fica SÓ na Cloud API,
-- conectado direto na Meta — sem Coexistence, que a Meta só libera por
-- intermediário. É o "caminho A sem app" que o RF-CON-02 já previa. Com isso
-- o botão que abria o WhatsApp Web deixa de ser o jeito de falar com o lead:
-- a conversa nasce, sai e volta DENTRO do CRM.
--
-- Até aqui o banco sabia receber, guardar e entregar, mas não sabia COMEÇAR:
-- um fio só nascia quando o parceiro escrevia ou quando o eco do Coexistence
-- avisava. Esta migração entrega as cinco peças que faltavam:
--
--   A. O modelo sabe quais variáveis tem e sabe se preencher
--      (`app.modelo_variaveis`, `app.modelo_renderizar`).
--   B. PRIMEIRO CONTATO É DERIVADO, NÃO DECLARADO. `messages.is_first_contact`
--      era escrito por quem inseria — e a tela nunca o escrevia. Um modelo
--      mandado para um lead novo entrava como "não é primeiro contato" e
--      passava por fora do teto diário do número (RF-CON-10). Agora um gatilho
--      deriva a coluna do estado da conversa, antes do `messages_guard`.
--   C. `public.wa_preparar_envio` — a pergunta que a tela faz ANTES de oferecer
--      o botão: o número está conectado? a ficha tem WhatsApp? a janela de 24 h
--      está aberta? o que barraria o envio agora, e quando abre?
--   D. `public.wa_enviar_modelo` — o envio: acha ou cria a conversa, confere e
--      preenche as variáveis, e enfileira a mensagem. A porteira continua sendo
--      o `messages_guard`; esta função não repete regra nenhuma dele.
--   E. As três portas do worker-wa para a Meta: `wa_modelos_para_meta`
--      (o que mandar para aprovação), `wa_modelo_meta_registrar` (o que a Meta
--      respondeu) e `wa_numero_configurar` (o número conectado).
--   F. VÁRIOS ATENDENTES NUM NÚMERO SÓ (pedido de 14/09, "algo parecido com o
--      que a BWA Global faz"): toda mensagem de texto sai com o primeiro nome
--      de quem escreveu em negrito na primeira linha; o modelo recebe o nome de
--      quem clicou em `{{atendente}}`; quem responde passa a atender a conversa;
--      e qualquer pessoa que escreve na base pode assumir uma conversa.
--
-- O QUE NÃO MUDA: ADR-05 (nada sai sem uma pessoa clicar), a supressão, a
-- janela de horário do RF-CON-11 e os tetos. Enviar fora do horário continua
-- sendo RECUSADO no clique, não adiado — é o que o gatilho sempre fez, e a
-- prévia existe para a tela dizer isso antes de a pessoa escrever.
-- =====================================================================


-- =====================================================================
-- A. O MODELO E AS SUAS VARIÁVEIS
-- =====================================================================

-- As variáveis nomeadas de um corpo, na ordem da primeira aparição, sem
-- repetir. `{{ nome }}` e `{{nome}}` são a mesma variável.
create or replace function app.modelo_variaveis(p_body text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(x.v order by x.primeira), '{}'::text[])
    from (select r.m[1] as v, min(r.ord) as primeira
            from regexp_matches(coalesce(p_body, ''),
                                '\{\{\s*([a-z][a-z0-9_]*)\s*\}\}', 'g')
                 with ordinality as r(m, ord)
           group by r.m[1]) x
$$;
comment on function app.modelo_variaveis(text) is
  'Variáveis nomeadas ({{nome}}) de um corpo de modelo, na ordem da primeira aparição e sem repetição.';
revoke all on function app.modelo_variaveis(text) from public, anon;
grant execute on function app.modelo_variaveis(text) to authenticated, service_role;

-- O valor de uma variável como a Meta aceita: sem quebra de linha, sem tab e
-- sem espaço repetido (a Graph API recusa parâmetro com qualquer um dos três).
-- Normalizar em vez de recusar: quem colou um nome com espaço sobrando não
-- errou nada.
create or replace function app.modelo_parametro_limpo(p_valor text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(btrim(regexp_replace(coalesce(p_valor, ''), '\s+', ' ', 'g')), '')
$$;
comment on function app.modelo_parametro_limpo(text) is
  'Valor de variável de modelo sem quebra de linha, tab ou espaço repetido — a forma que a Graph API aceita. Vazio vira null.';
revoke all on function app.modelo_parametro_limpo(text) from public, anon;
grant execute on function app.modelo_parametro_limpo(text) to authenticated, service_role;

-- O corpo preenchido. Variável sem valor fica como está, e quem chama decide
-- se isso é erro (no envio, é).
create or replace function app.modelo_renderizar(p_body text, p_parametros jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_corpo text := coalesce(p_body, '');
  v_var   text;
  v_valor text;
begin
  foreach v_var in array app.modelo_variaveis(p_body) loop
    v_valor := app.modelo_parametro_limpo(p_parametros ->> v_var);
    if v_valor is not null then
      -- Barra invertida é especial no texto de substituição do regexp_replace.
      v_corpo := regexp_replace(v_corpo, '\{\{\s*' || v_var || '\s*\}\}',
                                replace(v_valor, '\', '\\'), 'g');
    end if;
  end loop;
  return v_corpo;
end $$;
comment on function app.modelo_renderizar(text, jsonb) is
  'Preenche as variáveis nomeadas de um corpo de modelo com um objeto {variavel: valor}. O que não tiver valor fica como {{variavel}}.';
revoke all on function app.modelo_renderizar(text, jsonb) from public, anon;
grant execute on function app.modelo_renderizar(text, jsonb) to authenticated, service_role;


-- =====================================================================
-- B. PRIMEIRO CONTATO É DERIVADO DO ESTADO DA CONVERSA
-- =====================================================================
-- Primeiro contato = a pessoa nunca escreveu (`last_inbound_at` vazio, a mesma
-- coluna de que a janela de 24 h deriva) e a conversa não tem mensagem recebida
-- nem mensagem enviada que não falhou. É a abertura que gasta o teto do número.
--
-- Por que gatilho separado e não mais um ramo do `messages_guard`: os
-- gatilhos BEFORE da mesma tabela disparam em ordem alfabética, e
-- `messages_deriva_primeiro_contato` vem antes de `messages_guard`. O guarda
-- recebe a coluna já derivada e segue sem mudar uma linha — e ele é o arquivo
-- mais conferido do projeto (migrações 000200, 000300 e 000400).
--
-- Fica de fora: mensagem recebida, eco (registro do que já aconteceu, e no
-- modo só-API não existe mais), confirmação de opt-out (o guarda a zera) e
-- toque de cadência (contado em `cadence_touches`, que é a parcela (a) de
-- `app.primeiros_contatos_do_dia`; derivar aqui contaria duas vezes).
create or replace function app.messages_deriva_primeiro_contato()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.direction = 'out'::app.msg_direction
     and new.origin = 'crm'
     and new.author_kind in ('human', 'bot_fixed', 'bot_ai')
     and new.cadence_touch_id is null then
    new.is_first_contact := not exists (
                              select 1 from public.conversations c
                               where c.id = new.conversation_id and c.last_inbound_at is not null)
                            and not exists (
                              select 1 from public.messages m
                               where m.conversation_id = new.conversation_id
                                 and (m.direction = 'in'::app.msg_direction
                                      or m.status <> 'failed'::app.msg_status));
  end if;
  return new;
end $$;
comment on function app.messages_deriva_primeiro_contato() is
  'Deriva messages.is_first_contact do estado da conversa (nenhuma recebida e nenhuma enviada viva). Dispara antes do messages_guard, que usa a coluna para o teto do RF-CON-10.';
revoke all on function app.messages_deriva_primeiro_contato() from public, anon, authenticated;

drop trigger if exists messages_deriva_primeiro_contato on public.messages;
create trigger messages_deriva_primeiro_contato before insert on public.messages
  for each row execute function app.messages_deriva_primeiro_contato();


-- =====================================================================
-- Apoio: o número da empresa e o destino da ficha
-- =====================================================================

-- O primeiro nome de uma pessoa do time, como o cliente vai ler: "Matheus".
-- `profiles.full_name` vem do Google e, sem nome lá, do começo do e-mail
-- ("matheus.rondon") — daí o corte no ponto e o `initcap` só quando o nome
-- veio todo em minúsculas ou todo em maiúsculas (não estraga "McDonald").
create or replace function app.primeiro_nome(p_profile uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when x.n = lower(x.n) or x.n = upper(x.n) then initcap(x.n) else x.n end
    from (select nullif(split_part(split_part(split_part(btrim(p.full_name), ' ', 1), '@', 1), '.', 1), '') as n
            from public.profiles p where p.id = p_profile) x
   where x.n is not null
$$;
comment on function app.primeiro_nome(uuid) is
  'Primeiro nome de uma pessoa do time, do jeito que o cliente lê no WhatsApp (assinatura e {{atendente}}).';
revoke all on function app.primeiro_nome(uuid) from public, anon;
grant execute on function app.primeiro_nome(uuid) to authenticated, service_role;

create or replace function app.wa_numero_padrao()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select nullif(btrim(coalesce(s.value ->> 'numero_padrao', '')), '')
    from public.app_settings s where s.key = 'whatsapp.envio'
$$;
comment on function app.wa_numero_padrao() is
  'O número da KOMUNE conectado na Cloud API (RF-CON-01), em E.164. Null enquanto nenhum número foi conectado por public.wa_numero_configurar.';
revoke all on function app.wa_numero_padrao() from public, anon;
grant execute on function app.wa_numero_padrao() to authenticated, service_role;

-- Para qual número a mensagem vai, e quem é a pessoa do outro lado.
-- O WhatsApp comercial da ficha primeiro (é o que `organizations.phone_e164`
-- guarda); sem ele, a pessoa principal; sem ela, a pessoa mais recente com
-- telefone. O nome vem da pessoa dona do número, ou da principal.
create or replace function app.wa_destino_da_ficha(p_organization_id uuid)
returns table (telefone text, contact_id uuid, primeiro_nome text)
language sql
stable
security definer
set search_path = ''
as $$
  with pessoas as (
    select c.id, c.phone_e164, oc.is_primary, c.created_at,
           nullif(btrim(coalesce(c.first_name, split_part(btrim(c.full_name), ' ', 1))), '') as nome
      from public.organization_contacts oc
      join public.contacts c on c.id = oc.contact_id
     where oc.organization_id = p_organization_id
       and c.deleted_at is null
  ),
  numero as (
    select coalesce(
             (select o.phone_e164 from public.organizations o where o.id = p_organization_id),
             (select p.phone_e164 from pessoas p where p.is_primary and p.phone_e164 is not null limit 1),
             (select p.phone_e164 from pessoas p where p.phone_e164 is not null
               order by p.created_at desc limit 1)) as telefone
  ),
  pessoa as (
    select p.id, p.nome
      from pessoas p, numero n
     order by (p.phone_e164 is not distinct from n.telefone and n.telefone is not null) desc,
              p.is_primary desc, p.created_at desc
     limit 1
  )
  select n.telefone, pe.id, pe.nome
    from numero n left join pessoa pe on true
$$;
comment on function app.wa_destino_da_ficha(uuid) is
  'O WhatsApp de uma ficha (da organização, da pessoa principal ou da pessoa mais recente com telefone) e a pessoa do outro lado.';
revoke all on function app.wa_destino_da_ficha(uuid) from public, anon, authenticated;
grant execute on function app.wa_destino_da_ficha(uuid) to service_role;

-- O segmento do R08 §2 da ficha, para a tela sugerir a abertura certa primeiro.
-- É sugestão de ordem, não regra: qualquer modelo aprovado continua disponível.
create or replace function app.segmento_da_ficha(p_organization_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case o.kind
           when 'cerimonialista'::app.org_kind then 'CER'
           when 'produtor'::app.org_kind       then 'FOR'
           when 'espaco'::app.org_kind         then 'ESP'
           else (select case c."group"
                          when 'alimentos_bebidas' then 'AEB'
                          when 'infraestrutura'    then 'INF'
                          when 'locais'            then 'ESP'
                          else 'PRE'
                        end
                   from public.organization_categories oc
                   join public.categories c on c.id = oc.category_id
                  where oc.organization_id = o.id
                  order by oc.is_primary desc, oc.created_at
                  limit 1)
         end
    from public.organizations o
   where o.id = p_organization_id
$$;
comment on function app.segmento_da_ficha(uuid) is
  'Segmento do playbook (R08 §2: AEB, INF, PRE, ESP, CER, FOR) de uma ficha, pelo tipo e pela categoria principal. Serve para ordenar sugestões de abertura.';
revoke all on function app.segmento_da_ficha(uuid) from public, anon, authenticated;
grant execute on function app.segmento_da_ficha(uuid) to service_role;


-- =====================================================================
-- C. A PRÉVIA — o que a tela pergunta antes de oferecer o botão
-- =====================================================================
-- Leitura pura: não cria conversa, não enfileira nada.
--
-- `bloqueio` repete as perguntas de `app.pode_enviar` que não dependem de a
-- conversa existir (supressão, janela de horário, teto do número). É PRÉVIA:
-- quem decide continua sendo o `messages_guard` no instante do insert. Se as
-- duas divergirem um dia, a tela oferece um botão que o banco recusa com a
-- frase certa — o contrário (a prévia deixar passar o que o banco barra
-- calado) não existe, porque o banco nunca barra calado.
create or replace function public.wa_preparar_envio(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
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
    elsif v_primeiro then
      v_teto   := app.teto_do_canal('whatsapp'::app.channel, v_dia);
      v_usados := app.primeiros_contatos_do_dia('whatsapp'::app.channel, v_dia, v_numero);
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
                            'atendente', app.primeiro_nome(auth.uid()))),
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
end $$;
comment on function public.wa_preparar_envio(uuid) is
  'Prévia do envio por WhatsApp a partir de uma ficha (leitura pura): número conectado, WhatsApp da ficha, janela de 24 h, primeiro contato, desde quando esperamos resposta, o que barraria o envio agora e quando abre, sugestões de preenchimento e os modelos aprovados pela Meta.';
revoke all on function public.wa_preparar_envio(uuid) from public, anon;
grant execute on function public.wa_preparar_envio(uuid) to authenticated;


-- =====================================================================
-- D. O ENVIO DE MODELO A PARTIR DA FICHA
-- =====================================================================
create or replace function public.wa_enviar_modelo(p_organization_id uuid,
                                                   p_template_id     int,
                                                   p_parametros      jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_eu       uuid := auth.uid();
  o          public.organizations%rowtype;
  t          public.message_templates%rowtype;
  v_numero   text := app.wa_numero_padrao();
  v_tel      text;
  v_ct       uuid;
  v_conv     uuid;
  v_msg      uuid;
  v_primeiro boolean;
  v_var      text;
  v_valor    text;
  v_params   jsonb := '{}'::jsonb;
  v_entrada  jsonb;
  v_faltando text[] := '{}'::text[];
  v_corpo    text;
begin
  -- Gente, não máquina: o envio é assinado por quem clicou (ADR-05).
  if v_eu is null or app.e_o_worker() or not app.can_write() then
    raise exception 'Sem permissão para enviar mensagem pelo WhatsApp' using errcode = '42501';
  end if;
  select * into o from public.organizations
   where id = p_organization_id and deleted_at is null;
  if not found or not app.org_is_visible(o.id) then
    raise exception 'Ficha não encontrada' using errcode = 'P0002';
  end if;

  if v_numero is null then
    raise exception 'Envio recusado: whatsapp_nao_configurado (RF-CON-01)' using errcode = '42501';
  end if;

  select d.telefone, d.contact_id into v_tel, v_ct from app.wa_destino_da_ficha(o.id) d;
  if v_tel is null then
    raise exception 'Envio recusado: ficha_sem_whatsapp' using errcode = '42501';
  end if;

  select * into t from public.message_templates
   where id = p_template_id and is_active and channel = 'whatsapp'::app.channel;
  if not found then
    raise exception 'Envio recusado: modelo_inexistente' using errcode = '42501';
  end if;
  -- As mensagens do sistema têm dono: a confirmação de opt-out é do
  -- `wa_optout_registrar`, e as outras não são para ser mandadas à mão.
  if t.template_code like 'GEN-SYS-%' then
    raise exception 'Envio recusado: modelo_de_sistema' using errcode = '42501';
  end if;

  -- `{{atendente}}` é sempre quem clicou, e quem chama não escolhe: um nome
  -- digitado ali seria alguém se apresentando como outra pessoa do time.
  v_entrada := coalesce(p_parametros, '{}'::jsonb)
               || jsonb_build_object('atendente', app.primeiro_nome(v_eu));

  -- Toda variável do corpo precisa de valor. Chave a mais é descartada: o que
  -- fica gravado é exatamente o que vai no fio.
  foreach v_var in array app.modelo_variaveis(t.body) loop
    v_valor := app.modelo_parametro_limpo(v_entrada ->> v_var);
    if v_valor is null then
      v_faltando := v_faltando || v_var;
    elsif length(v_valor) > 200 then
      raise exception 'Envio recusado: parametro_longo_demais (%)', v_var using errcode = '22023';
    else
      v_params := v_params || jsonb_build_object(v_var, v_valor);
    end if;
  end loop;
  if cardinality(v_faltando) > 0 then
    raise exception 'Envio recusado: modelo_sem_parametro (%)', array_to_string(v_faltando, ', ')
      using errcode = '22023';
  end if;
  v_corpo := app.modelo_renderizar(t.body, v_params);

  -- A conversa: uma por par (número da empresa × número da pessoa).
  select c.id into v_conv from public.conversations c
   where c.channel = 'whatsapp'::app.channel
     and c.business_number = v_numero and c.peer_phone_e164 = v_tel;
  if v_conv is null then
    insert into public.conversations (channel, business_number, peer_phone_e164,
                                      organization_id, contact_id, assignee_id, status)
    values ('whatsapp'::app.channel, v_numero, v_tel, o.id, v_ct,
            coalesce((select p.id from public.profiles p where p.id = o.owner_id and p.is_active), v_eu),
            'aguardando_parceiro')
    returning id into v_conv;
  else
    update public.conversations
       set organization_id = coalesce(organization_id, o.id),
           contact_id      = coalesce(contact_id, v_ct)
     where id = v_conv and (organization_id is null or contact_id is null);
  end if;

  -- Fora da janela de 24 h só vai modelo que a META aprovou. É a pergunta que
  -- `public.wa_saida_proximos` faz na saída; fazê-la aqui evita enfileirar uma
  -- mensagem que nasceria para morrer com `sem_modelo_aprovado`.
  if not app.janela_de_24h_aberta(v_conv, now())
     and not coalesce((app.wa_modelo_da_meta(t.id) ->> 'aprovado')::boolean, false) then
    raise exception 'Envio recusado: modelo_nao_aprovado_na_meta' using errcode = '42501';
  end if;

  -- O `messages_guard` confere supressão, janela de horário e tetos, e recusa
  -- com exceção — que desfaz também a conversa criada acima.
  insert into public.messages (conversation_id, direction, type, status, body,
                               template_id, template_params, author_kind, sent_by, origin)
  values (v_conv, 'out'::app.msg_direction, 'template'::app.msg_type, 'queued'::app.msg_status,
          v_corpo, t.id, v_params, 'human', v_eu, 'crm')
  returning id, is_first_contact into v_msg, v_primeiro;

  return jsonb_build_object('ok', true, 'conversation_id', v_conv, 'message_id', v_msg,
                            'primeiro_contato', v_primeiro, 'corpo', v_corpo);
end $$;
comment on function public.wa_enviar_modelo(uuid, int, jsonb) is
  'Envia um modelo de mensagem para o WhatsApp de uma ficha: acha ou cria a conversa, exige valor para toda variável, exige aprovação da Meta fora da janela de 24 h e enfileira a mensagem assinada por quem clicou. Supressão, horário e tetos são do messages_guard.';
revoke all on function public.wa_enviar_modelo(uuid, int, jsonb) from public, anon;
grant execute on function public.wa_enviar_modelo(uuid, int, jsonb) to authenticated;


-- =====================================================================
-- E. AS PORTAS DO WORKER-WA PARA A META
-- =====================================================================

alter table public.message_templates
  add column if not exists meta_status_raw       text,
  add column if not exists meta_rejection_reason text,
  add column if not exists meta_template_id      text,
  add column if not exists meta_synced_at        timestamptz;
comment on column public.message_templates.meta_status_raw is
  'O status exatamente como a Meta devolveu (APPROVED, PENDING, REJECTED, PAUSED, DISABLED…) ou NAO_ENVIADO quando o worker recusou antes de mandar. meta_status é a leitura em três estados.';
comment on column public.message_templates.meta_rejection_reason is
  'Por que a Meta recusou, pausou ou desativou — ou por que o worker nem mandou.';

-- O que mandar para aprovação: todo modelo ativo de WhatsApp que a Meta
-- precisa aprovar para sair fora da janela (marketing e utility), mais a
-- confirmação de opt-out, que sai fora da janela como utility e com o texto
-- fixo que o banco deriva (`app.corpo_fixo_de_optout`) — não com o corpo cru,
-- que ainda tem o vocativo.
create or replace function public.wa_modelos_para_meta()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'template_id',     t.id,
           'codigo',          t.template_code,
           'nome_meta_atual', t.meta_template_name,
           'situacao_atual',  t.meta_status,
           'nome_sugerido',   lower(regexp_replace(t.template_code, '[^A-Za-z0-9]+', '_', 'g'))
                                || '_v' || t.version,
           'categoria',       upper(case when t.template_code = 'GEN-SYS-OPTOUT' then 'utility'
                                         else t.category end),
           'idioma',          t.language,
           'corpo',           x.corpo,
           'variaveis',       to_jsonb(app.modelo_variaveis(x.corpo)))
         order by t.template_code), '[]'::jsonb)
    from public.message_templates t
    cross join lateral (
      select regexp_replace(
               case when t.template_code = 'GEN-SYS-OPTOUT' then app.corpo_fixo_de_optout(t.body)
                    else t.body end,
               '\{\{\s*([a-z][a-z0-9_]*)\s*\}\}', '{{\1}}', 'g') as corpo
    ) x
   where t.is_active
     and t.channel = 'whatsapp'::app.channel
     and (t.category in ('marketing', 'utility') or t.template_code = 'GEN-SYS-OPTOUT')
     and x.corpo is not null
$$;
comment on function public.wa_modelos_para_meta() is
  'Os modelos que o worker-wa manda para aprovação na Meta, com nome sugerido (código + versão), categoria, idioma, corpo com variáveis nomeadas e a lista de variáveis.';
revoke all on function public.wa_modelos_para_meta() from public, anon, authenticated;
grant execute on function public.wa_modelos_para_meta() to service_role;

-- O que a Meta respondeu. Status desconhecido é tratado como NÃO aprovado:
-- falhar fechado aqui significa uma mensagem que não sai, e falhar aberto
-- significaria um 132001 da Graph API contando contra o número.
create or replace function public.wa_modelo_meta_registrar(p_template_id   int,
                                                           p_nome_meta     text,
                                                           p_situacao_meta text,
                                                           p_motivo        text default null,
                                                           p_id_meta       text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cru    text := upper(btrim(coalesce(p_situacao_meta, '')));
  v_status text;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
begin
  if not app.e_o_worker() then
    raise exception 'Só o worker registra o que a Meta respondeu' using errcode = '42501';
  end if;
  v_status := case
                when v_cru = 'APPROVED' then 'approved'
                when v_cru in ('PENDING', 'IN_APPEAL', 'LIMIT_EXCEEDED') then 'pending'
                else 'rejected'
              end;
  -- A Meta devolve rejected_reason = "NONE" para o que está aprovado.
  if v_status = 'approved' or upper(coalesce(v_motivo, '')) = 'NONE' then
    v_motivo := null;
  end if;

  update public.message_templates
     set meta_template_name    = coalesce(nullif(btrim(coalesce(p_nome_meta, '')), ''), meta_template_name),
         meta_status           = v_status,
         meta_status_raw       = nullif(v_cru, ''),
         meta_rejection_reason = v_motivo,
         meta_template_id      = coalesce(nullif(btrim(coalesce(p_id_meta, '')), ''), meta_template_id),
         meta_synced_at        = now()
   where id = p_template_id;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'modelo_inexistente');
  end if;
  return jsonb_build_object('ok', true, 'meta_status', v_status);
end $$;
comment on function public.wa_modelo_meta_registrar(int, text, text, text, text) is
  'Grava o que a Meta respondeu sobre um modelo (nome, status cru, motivo, id) e a leitura em três estados: APPROVED → approved; PENDING, IN_APPEAL, LIMIT_EXCEEDED → pending; qualquer outro → rejected.';
revoke all on function public.wa_modelo_meta_registrar(int, text, text, text, text) from public, anon, authenticated;
grant execute on function public.wa_modelo_meta_registrar(int, text, text, text, text) to service_role;

-- O número conectado. Grava o E.164 em `whatsapp.envio.numero_padrao` — que é
-- o que a tela lê para saber se o WhatsApp existe — e os dados públicos do
-- número em `whatsapp.numero` (ids da Meta não são segredo; o token é).
--
-- NÚMERO NOVO RECOMEÇA O AQUECIMENTO. O teto de primeiros contatos sobe por
-- semana a partir de `cadencia.tetos.inicio` (20 → 35 → 45). Essa data foi
-- semeada no D1, quando não havia número nenhum; contar o aquecimento de um
-- número que nasce hoje a partir de 04/09 o poria direto no teto da terceira
-- semana. Quando o número muda, a contagem recomeça hoje.
create or replace function public.wa_numero_configurar(p_numero          text,
                                                       p_phone_number_id text,
                                                       p_waba_id         text,
                                                       p_nome_exibicao   text default null,
                                                       p_qualidade       text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_num      text := app.normalize_phone_br(p_numero);
  v_anterior text := app.wa_numero_padrao();
begin
  if not app.e_o_worker() then
    raise exception 'Só o worker conecta o número' using errcode = '42501';
  end if;
  if v_num is null then
    -- normalize_phone_br é do Brasil; um número de fora ainda precisa virar E.164.
    v_num := nullif('+' || regexp_replace(coalesce(p_numero, ''), '\D', '', 'g'), '+');
  end if;
  if v_num is null or v_num !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'Número inválido: %', coalesce(p_numero, '(vazio)') using errcode = '22023';
  end if;

  update public.app_settings
     set value = jsonb_set(value, '{numero_padrao}', to_jsonb(v_num)), updated_at = now()
   where key = 'whatsapp.envio';
  if not found then
    insert into public.app_settings (key, value, description)
    values ('whatsapp.envio',
            jsonb_build_object('numero_padrao', v_num, 'teto_iniciadas_dia', 150,
                               'teto_iniciadas_hora', 60, 'intervalo_min_seg', 45,
                               'intervalo_max_seg', 180),
            'Tetos de volume do RF-CON-10 e o número conectado na Cloud API.');
  end if;

  insert into public.app_settings (key, value, description)
  values ('whatsapp.numero',
          jsonb_build_object('numero', v_num,
                             'phone_number_id', nullif(btrim(coalesce(p_phone_number_id, '')), ''),
                             'waba_id', nullif(btrim(coalesce(p_waba_id, '')), ''),
                             'nome_exibicao', nullif(btrim(coalesce(p_nome_exibicao, '')), ''),
                             'qualidade', nullif(btrim(coalesce(p_qualidade, '')), ''),
                             'conectado_em', now()),
          'O número da KOMUNE na Cloud API da Meta (RF-CON-01): ids públicos, nome de exibição e qualidade na última conexão. O token não fica aqui.')
  on conflict (key) do update
    set value = excluded.value
                || jsonb_build_object('conectado_em',
                     case when public.app_settings.value ->> 'numero' = v_num
                          then public.app_settings.value -> 'conectado_em'
                          else to_jsonb(now()) end),
        updated_at = now();

  if v_anterior is distinct from v_num then
    update public.app_settings
       set value = jsonb_set(value, '{inicio}',
                             to_jsonb(to_char((now() at time zone 'America/Fortaleza')::date, 'YYYY-MM-DD'))),
           updated_at = now()
     where key = 'cadencia.tetos';
  end if;

  return jsonb_build_object('ok', true, 'numero_padrao', v_num,
                            'aquecimento_recomecou', v_anterior is distinct from v_num);
end $$;
comment on function public.wa_numero_configurar(text, text, text, text, text) is
  'Conecta o número da KOMUNE (RF-CON-01): grava o E.164 em whatsapp.envio.numero_padrao, os dados públicos em whatsapp.numero e, quando o número muda, recomeça o aquecimento do teto (cadencia.tetos.inicio = hoje).';
revoke all on function public.wa_numero_configurar(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.wa_numero_configurar(text, text, text, text, text) to service_role;



-- =====================================================================
-- F. VÁRIOS ATENDENTES NUM NÚMERO SÓ
-- =====================================================================
-- O número é um só e quem escreve são várias pessoas. Do lado de dentro o CRM
-- sempre soube quem mandou (`sent_by`, `approved_by`); do lado de fora o
-- parceiro via "Komune" e mais nada. Três peças:

-- 1 · A ASSINATURA. Texto livre sai com o primeiro nome em negrito na primeira
--     linha — `*Matheus:*` é negrito no WhatsApp. Gravada NO CORPO, e não
--     acrescentada pelo worker na hora de mandar: `messages.body` é o registro
--     do que foi ao fio, e um registro que diz uma coisa enquanto o parceiro
--     leu outra é o defeito que a migração 000400 passou um dia inteiro
--     fechando.
--
--     Por que gatilho próprio, e depois do guarda: gatilhos BEFORE disparam em
--     ordem alfabética, e `messages_nome_do_atendente` vem depois de
--     `messages_guard`. O guarda compara o corpo da mensagem de IA com o texto
--     que a pessoa aprovou (`final_body`) — ele precisa ver o texto sem a
--     assinatura, e a assinatura entra só depois de ele aprovar.
--
--     Fica de fora: modelo (o texto é o que a Meta aprovou; o nome vai em
--     `{{atendente}}`), confirmação de opt-out (é do sistema, não de uma
--     pessoa), eco e mídia. Desliga em `whatsapp.envio.assinar_com_nome`.
insert into public.app_settings (key, value, description)
values ('whatsapp.envio', jsonb_build_object('assinar_com_nome', true), 'Tetos de volume do RF-CON-10 e o número conectado na Cloud API.')
on conflict (key) do update
  set value = case when public.app_settings.value ? 'assinar_com_nome' then public.app_settings.value
                   else public.app_settings.value || jsonb_build_object('assinar_com_nome', true) end;

create or replace function app.messages_nome_do_atendente()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nome  text;
  v_linha text;
begin
  if new.direction <> 'out'::app.msg_direction
     or new.origin <> 'crm'
     or new.type <> 'text'::app.msg_type
     or new.template_id is not null
     or new.optout_confirmation
     or new.author_kind not in ('human', 'bot_ai')
     or nullif(btrim(coalesce(new.body, '')), '') is null
     or not coalesce((select (s.value ->> 'assinar_com_nome')::boolean
                        from public.app_settings s where s.key = 'whatsapp.envio'), true) then
    return new;
  end if;

  -- Mensagem de IA é assinada por quem APROVOU: foi essa pessoa que decidiu
  -- que o texto saía (ADR-05).
  v_nome := app.primeiro_nome(case when new.author_kind = 'bot_ai' then new.approved_by
                                   else new.sent_by end);
  if v_nome is null then
    return new;
  end if;

  v_linha := '*' || v_nome || ':*';
  if left(new.body, length(v_linha)) is distinct from v_linha then
    new.body := v_linha || E'\n' || new.body;
  end if;
  return new;
end $$;
comment on function app.messages_nome_do_atendente() is
  'Assina o texto livre de WhatsApp com o primeiro nome de quem escreveu (ou aprovou, se veio da IA) em negrito na primeira linha. Dispara depois do messages_guard.';
revoke all on function app.messages_nome_do_atendente() from public, anon, authenticated;

drop trigger if exists messages_nome_do_atendente on public.messages;
create trigger messages_nome_do_atendente before insert on public.messages
  for each row execute function app.messages_nome_do_atendente();

-- 2 · QUEM RESPONDE, ATENDE. `conversations.assignee_id` é o "Atendendo" da
--     tela. Com o time inteiro no mesmo número, a pergunta útil é "quem está
--     falando com este parceiro agora?", e a resposta honesta é quem mandou a
--     última mensagem — não o dono da ficha, que pode nem ter aberto a conversa.
--     O dono do NEGÓCIO (`deals.owner_id`, o "Responsável") não muda.
create or replace function app.messages_quem_responde_atende()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quem uuid;
begin
  if new.direction = 'out'::app.msg_direction and new.origin = 'crm'
     and new.author_kind in ('human', 'bot_ai') then
    v_quem := case when new.author_kind = 'bot_ai' then new.approved_by else new.sent_by end;
    if v_quem is not null then
      update public.conversations c
         set assignee_id = v_quem
       where c.id = new.conversation_id
         and c.assignee_id is distinct from v_quem
         and exists (select 1 from public.profiles p where p.id = v_quem and p.is_active);
    end if;
  end if;
  return null;
end $$;
comment on function app.messages_quem_responde_atende() is
  'Quem manda mensagem numa conversa passa a atendê-la (conversations.assignee_id). O responsável pelo negócio não muda.';
revoke all on function app.messages_quem_responde_atende() from public, anon, authenticated;

drop trigger if exists messages_quem_responde_atende on public.messages;
create trigger messages_quem_responde_atende after insert on public.messages
  for each row execute function app.messages_quem_responde_atende();

-- 3 · ASSUMIR ANTES DE RESPONDER. A policy de update de `conversations` só
--     deixa o gestor ou o atendente atual mexer — certo para o resto da linha,
--     errado para "deixa comigo". Esta função muda UMA coluna, para a pessoa
--     que chamou, e só onde ela já poderia escrever.
create or replace function public.assumir_conversa(p_conversation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_eu uuid := auth.uid();
  c    public.conversations%rowtype;
begin
  if v_eu is null or app.e_o_worker() or not app.can_write() then
    raise exception 'Sem permissão para atender conversas' using errcode = '42501';
  end if;
  select * into c from public.conversations where id = p_conversation_id;
  if not found
     or not (app.sees_all()
             or c.assignee_id = v_eu
             or (app.role() = 'embaixador'::app.user_role
                 and c.organization_id is not null and app.org_is_mine(c.organization_id))) then
    raise exception 'Conversa não encontrada' using errcode = 'P0002';
  end if;
  if c.assignee_id = v_eu then
    return jsonb_build_object('ok', true, 'ja_era_sua', true, 'anterior', null);
  end if;
  update public.conversations set assignee_id = v_eu where id = c.id;
  return jsonb_build_object('ok', true, 'ja_era_sua', false,
                            'anterior', app.primeiro_nome(c.assignee_id));
end $$;
comment on function public.assumir_conversa(uuid) is
  'A pessoa que chama passa a atender a conversa (conversations.assignee_id), onde já poderia escrever. Fica no audit_log pelo gatilho da tabela.';
revoke all on function public.assumir_conversa(uuid) from public, anon;
grant execute on function public.assumir_conversa(uuid) to authenticated;

notify pgrst, 'reload schema';

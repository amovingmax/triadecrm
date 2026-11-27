-- =====================================================================
-- "Chamar com a IA": o lead do portal que nunca falou com a Imova — só na
-- Imova (27/11/2026)
--
-- Quem fala com a Imova pelo chat da OLX, ou só clica em "ver telefone" no
-- portal, deixa nome, telefone e e-mail (`portal_lead_contatos`), mas não
-- escreve no WhatsApp: a IA que atende só responde quem escreve, e o lead
-- ficava em "novo" para sempre. Em 27/11/2026 eram 3 de 12.
--
-- Decisão do dono (entrevista de 24/11, item 28; "Pode começar" em 27/11): um
-- botão "Chamar com a IA" na ficha do lead sem conversa. O clique manda o modelo
-- aprovado por ele:
--
--   "Olá, {{nome}}! Aqui é da Imova. Vimos seu interesse {{imovel_visto}}.
--    Posso te passar mais informações?"
--
-- (`IMV-LEAD-PORTAL`, `imv_lead_portal_v1`, pedido à Meta como UTILITY em
-- 27/11/2026 com o exemplo "no terreno de 3.000 m² em Capim Macio".) O nome e o
-- trecho do imóvel vêm sugeridos e a pessoa confere antes de mandar. Só sai com
-- o clique. Se o cliente responder, a IA assume sozinha: o modelo sai como
-- mensagem automática (`bot_fixed`), e `app.ia_atende` só deixa a conversa com
-- a equipe quando uma PESSOA escreveu nas últimas 24 h. A IA lê a própria frase
-- do modelo no histórico e sabe de qual imóvel se trata.
--
-- O QUE ESTA MIGRAÇÃO FAZ
--   1. Liga o modelo `IMV-LEAD-PORTAL` (a linha já existe em produção, desligada,
--      com o pedido feito à Meta; num banco novo ela nasce aqui e a
--      sincronização do worker-wa pede a aprovação).
--   2. `app.chamado_primeiro_nome` e `app.chamado_imovel_visto`: as sugestões
--      ("Cesar"; "na sala comercial de 19 m² para alugar em Ponta Negra, no OLX").
--   3. `public.portal_lead_chamar_previa(lead)`: o que o diálogo mostra — pode ou
--      não pode (e por quê), as sugestões, o texto e a situação do modelo.
--   4. `public.portal_lead_chamar(lead, nome, imovel_visto)`: confere tudo de
--      novo, liga (ou cria) a ficha do lead pela função de sempre
--      (`app.portal_lead_ligar_ficha`), abre a conversa e põe o modelo na fila
--      pela porteira de sempre (`messages_guard`: supressão, horário, tetos).
--      O lead fica ligado à conversa e sai de "novo".
--
-- COMO DESFAZER (no banco da Imova):
--   drop function if exists public.portal_lead_chamar(uuid, text, text),
--     public.portal_lead_chamar_previa(uuid), app.chamado_imovel_visto(uuid),
--     app.chamado_primeiro_nome(text), app.chamado_impedimento(uuid);
--   update public.message_templates set is_active = false where template_code = 'IMV-LEAD-PORTAL';
-- =====================================================================

do $chamar$
begin
  if (select i.empresa from app.identidade i) = 'komune' then
    raise notice 'Os leads dos portais são só da Imova: no banco da KOMUNE nada foi criado.';
    return;
  end if;

  -- 1. O modelo.
  insert into public.message_templates (template_code, name, channel, category, segment, kind,
                                        language, body, variables, botoes, is_active, version)
  values ('IMV-LEAD-PORTAL', 'Chamar com a IA: lead do portal sem conversa', 'whatsapp'::app.channel,
          'utility', 'GEN', 'lead_portal', 'pt_BR',
          'Olá, {{nome}}! Aqui é da Imova. Vimos seu interesse {{imovel_visto}}. Posso te passar mais informações?',
          '["imovel_visto", "nome"]'::jsonb, '[]'::jsonb, true, 1)
  on conflict (template_code) do update set is_active = true, updated_at = now();

  execute $ddl$

-- 2. As sugestões.
create or replace function app.chamado_primeiro_nome(p_nome text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(initcap(lower(split_part(
           btrim(regexp_replace(coalesce(p_nome, ''), '[^[:alpha:]''-]+', ' ', 'g')), ' ', 1))), '')
$$;
comment on function app.chamado_primeiro_nome(text) is
  'O primeiro nome para o "Olá, {{nome}}!" do Chamar com a IA: só letras, com a primeira maiúscula ("CESAR FORTUNA" → "Cesar"). Nulo se não sobrar letra.';
revoke all on function app.chamado_primeiro_nome(text) from public, anon;
grant execute on function app.chamado_primeiro_nome(text) to authenticated, service_role;

create or replace function app.chamado_imovel_visto(p_lead uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  l       public.portal_leads%rowtype;
  a       public.anuncios%rowtype;
  v_frase text;
  v_area  numeric;
  v_onde  text;
  v_portal text;
begin
  select * into l from public.portal_leads where id = p_lead;
  if not found then
    return null;
  end if;
  v_portal := case l.portal
                when 'olx' then ', no OLX'
                when 'zap' then ', no ZAP Imóveis'
                when 'vivareal' then ', no Viva Real'
                -- O chat só existe na OLX (23/11/2026).
                else case when 'CONTACT_CHAT' = any (coalesce(l.tipos, '{}')) then ', no OLX' else '' end
              end;
  if l.anuncio_id is not null then
    select * into a from public.anuncios where id = l.anuncio_id;
  end if;
  if a.id is null then
    return 'no nosso anúncio' || v_portal;
  end if;

  v_frase := case a.tipo
               when 'terreno' then 'no terreno'
               when 'casa' then 'na casa'
               when 'apartamento' then 'no apartamento'
               when 'studio' then 'no studio'
               when 'loft' then 'no loft'
               when 'cobertura' then 'na cobertura'
               when 'sala_comercial' then 'na sala comercial'
               when 'consultorio' then 'no consultório'
               when 'loja' then 'na loja'
               when 'chacara' then 'na chácara'
               when 'fazenda_sitio' then 'no sítio'
               when 'galpao' then 'no galpão'
               when 'imovel_comercial' then 'no imóvel comercial'
               when 'predio_comercial' then 'no prédio comercial'
               when 'predio_residencial' then 'no prédio residencial'
               when 'andar_corporativo' then 'no andar corporativo'
               else 'no imóvel'
             end;
  -- Residência com quartos: "de 3 quartos"; o resto, a área ("de 3.000 m²").
  if a.tipo in ('casa', 'apartamento', 'cobertura') and coalesce(a.quartos, 0) > 0 then
    v_frase := v_frase || ' de ' || a.quartos || case when a.quartos = 1 then ' quarto' else ' quartos' end;
  else
    v_area := case when a.tipo in ('terreno', 'chacara', 'fazenda_sitio') then coalesce(a.area_total, a.area_util)
                   else coalesce(a.area_util, a.area_total) end;
    if v_area is not null and v_area >= 10 then
      v_frase := v_frase || ' de ' || replace(to_char(round(v_area)::bigint, 'FM999,999,999'), ',', '.') || ' m²';
    end if;
  end if;
  if a.negocio = 'aluguel' then
    v_frase := v_frase || ' para alugar';
  end if;
  v_onde := coalesce(nullif(btrim(a.bairro), ''), nullif(btrim(a.cidade), ''));
  if v_onde is not null then
    v_frase := v_frase || ' em ' || v_onde;
  end if;
  return left(v_frase || v_portal, 160);
end $$;
comment on function app.chamado_imovel_visto(uuid) is
  'O trecho do imóvel para o "Vimos seu interesse {{imovel_visto}}" do Chamar com a IA, a partir do anúncio do lead: tipo com o artigo, quartos ou área, "para alugar", bairro e o portal quando é certo ("na sala comercial de 19 m² para alugar em Ponta Negra, no OLX"). Sem anúncio: "no nosso anúncio". A pessoa confere antes de mandar.';
revoke all on function app.chamado_imovel_visto(uuid) from public, anon, authenticated;
grant execute on function app.chamado_imovel_visto(uuid) to service_role;

-- O que impede chamar este lead (nulo = nada), antes do modelo e da porteira.
create or replace function app.chamado_impedimento(p_lead uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  l     public.portal_leads%rowtype;
  v_tel text;
begin
  select * into l from public.portal_leads where id = p_lead;
  if not found or l.escondido_em is not null then
    return 'lead_nao_encontrado';
  end if;
  if l.suprimido then
    return 'suprimido';
  end if;
  if l.situacao = 'descartado' then
    return 'descartado';
  end if;
  if l.conversation_id is not null then
    return 'ja_tem_conversa';
  end if;
  if l.contato_apagado_em is not null then
    return 'contato_apagado';
  end if;
  select nullif(btrim(k.telefone_e164), '') into v_tel from public.portal_lead_contatos k where k.lead_id = l.id;
  if v_tel is null and l.organization_id is not null then
    select d.telefone into v_tel from app.wa_destino_da_ficha(l.organization_id) d;
  end if;
  if v_tel is null then
    return 'sem_telefone';
  end if;
  return null;
end $$;
comment on function app.chamado_impedimento(uuid) is
  'Por que o lead do portal não pode ser chamado com a IA (nulo = pode): não existe ou foi escondido, suprimido, descartado, já tem conversa, contato apagado, sem telefone.';
revoke all on function app.chamado_impedimento(uuid) from public, anon, authenticated;
grant execute on function app.chamado_impedimento(uuid) to service_role;

-- 3. A prévia do diálogo.
create or replace function public.portal_lead_chamar_previa(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  t        public.message_templates%rowtype;
  v_nome   text;
  v_imovel text;
  v_motivo text;
  v_modelo text;
begin
  if not app.is_manager() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if not exists (select 1 from public.portal_leads l where l.id = p_id) then
    return jsonb_build_object('ok', false, 'motivo', 'lead_nao_encontrado');
  end if;
  v_motivo := app.chamado_impedimento(p_id);
  select * into t from public.message_templates where template_code = 'IMV-LEAD-PORTAL';
  v_modelo := case when t.id is null then 'ausente'
                   when not t.is_active then 'desligado'
                   else coalesce(t.meta_status, 'nao_enviado') end;
  select app.chamado_primeiro_nome(coalesce(nullif(btrim(k.nome), ''),
                                            (select o.name from public.organizations o where o.id = l.organization_id)))
    into v_nome
    from public.portal_leads l
    left join public.portal_lead_contatos k on k.lead_id = l.id
   where l.id = p_id;
  v_imovel := app.chamado_imovel_visto(p_id);
  return jsonb_build_object(
    'ok', true,
    'pode', v_motivo is null and v_modelo = 'approved',
    'motivo', coalesce(v_motivo, case when v_modelo <> 'approved' then 'modelo_' || v_modelo end),
    'nome', v_nome,
    'imovel_visto', v_imovel,
    'texto', case when t.id is not null then app.modelo_renderizar(t.body,
               jsonb_build_object('nome', coalesce(v_nome, '…'), 'imovel_visto', v_imovel)) end,
    'modelo', v_modelo,
    'categoria', t.category);
end $$;
comment on function public.portal_lead_chamar_previa(uuid) is
  'O diálogo do Chamar com a IA (admin, gestor e SDR): se pode chamar o lead do portal (e o motivo quando não), o primeiro nome e o trecho do imóvel sugeridos, o texto como sairia, a situação do modelo IMV-LEAD-PORTAL na Meta e a categoria (o custo). Não grava nada.';
revoke all on function public.portal_lead_chamar_previa(uuid) from public, anon;
grant execute on function public.portal_lead_chamar_previa(uuid) to authenticated;

-- 4. Chamar.
create or replace function public.portal_lead_chamar(p_id uuid, p_nome text, p_imovel_visto text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  l        public.portal_leads%rowtype;
  t        public.message_templates%rowtype;
  c        public.conversations%rowtype;
  v_nome   text := app.modelo_parametro_limpo(p_nome);
  v_imovel text := app.modelo_parametro_limpo(p_imovel_visto);
  v_motivo text;
  v_tel    text;
  v_email  text;
  v_nome_k text;
  v_ficha  text;
  v_org    uuid;
  v_ct     uuid;
  v_numero text := app.wa_numero_padrao();
  v_conv   uuid;
  v_params jsonb;
  v_corpo  text;
  v_msg    uuid;
begin
  if not app.is_manager() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  -- Dois cliques ao mesmo tempo: o segundo espera e encontra a conversa.
  select * into l from public.portal_leads where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'lead_nao_encontrado');
  end if;
  v_motivo := app.chamado_impedimento(p_id);
  if v_motivo is not null then
    return jsonb_build_object('ok', false, 'motivo', v_motivo);
  end if;

  select * into t from public.message_templates where template_code = 'IMV-LEAD-PORTAL';
  if t.id is null or not t.is_active then
    return jsonb_build_object('ok', false, 'motivo', 'modelo_desligado');
  end if;
  if t.meta_status is distinct from 'approved' then
    return jsonb_build_object('ok', false, 'motivo', 'modelo_' || coalesce(t.meta_status, 'nao_enviado'));
  end if;

  -- O que vai ao cliente: um nome (letras, até 40) e um trecho do imóvel sem
  -- número comprido (nada que pareça telefone ou documento), até 160.
  if v_nome is null or char_length(v_nome) > 40 or v_nome !~ '[[:alpha:]]' or v_nome ~ '[0-9]' then
    return jsonb_build_object('ok', false, 'motivo', 'nome_invalido');
  end if;
  if v_imovel is null or char_length(v_imovel) < 5 or char_length(v_imovel) > 160
     or v_imovel ~ '[0-9][0-9 .,()/-]{8,}[0-9]' then
    return jsonb_build_object('ok', false, 'motivo', 'imovel_invalido');
  end if;
  if v_numero is null then
    return jsonb_build_object('ok', false, 'motivo', 'whatsapp_nao_configurado');
  end if;

  select nullif(btrim(k.telefone_e164), ''), nullif(lower(btrim(k.email)), ''), nullif(btrim(k.nome), '')
    into v_tel, v_email, v_nome_k
    from public.portal_lead_contatos k where k.lead_id = l.id;

  -- A ficha: a que o lead já tem, ou a de sempre (acha pelo telefone ou e-mail, ou cria
  -- a de Cliente com origem Portais). Quem só clicou ainda não tinha ficha.
  v_org := l.organization_id;
  if v_org is null then
    v_ficha := app.portal_lead_ligar_ficha(l.id, v_tel, v_email, v_nome_k, l.transacao,
                 'Lead do portal chamado pelo botão "Chamar com a IA".');
    if v_ficha = 'suprimida' then
      return jsonb_build_object('ok', false, 'motivo', 'suprimido');
    end if;
    select p.organization_id into v_org from public.portal_leads p where p.id = l.id;
    if v_org is null then
      return jsonb_build_object('ok', false, 'motivo', 'ficha_' || coalesce(v_ficha, 'nao_criada'));
    end if;
  end if;
  if v_tel is null then
    select d.telefone into v_tel from app.wa_destino_da_ficha(v_org) d;
  end if;
  select d.contact_id into v_ct from app.wa_destino_da_ficha(v_org) d where d.telefone = v_tel;

  v_motivo := app.wa_motivo_de_recusa(v_org, v_ct, v_tel);
  if v_motivo is not null then
    return jsonb_build_object('ok', false, 'motivo', v_motivo);
  end if;

  select * into c from public.conversations x
   where x.channel = 'whatsapp'::app.channel and x.business_number = v_numero and x.peer_phone_e164 = v_tel;
  if c.id is not null and c.bloqueada_em is not null then
    return jsonb_build_object('ok', false, 'motivo', 'conversa_bloqueada');
  end if;

  v_params := jsonb_build_object('nome', v_nome, 'imovel_visto', v_imovel);
  v_corpo := app.modelo_renderizar(t.body, v_params);
  begin
    v_conv := c.id;
    if v_conv is null then
      -- `assignee_id` nulo: quem escolhe é `conversations_before_write`, como no lembrete.
      insert into public.conversations (channel, business_number, peer_phone_e164, peer_nome,
                                        organization_id, contact_id, assignee_id, status)
      values ('whatsapp'::app.channel, v_numero, v_tel, v_nome_k, v_org, v_ct, null, 'aguardando_parceiro')
      returning id into v_conv;
    end if;
    -- A porteira (`messages_guard` + `app.pode_enviar`) confere supressão, horário e
    -- tetos, e recusa com exceção, que desfaz a conversa criada aqui em cima.
    insert into public.messages (conversation_id, direction, type, status, body,
                                 template_id, template_params, author_kind, origin)
    values (v_conv, 'out'::app.msg_direction, 'template'::app.msg_type, 'queued'::app.msg_status,
            v_corpo, t.id, v_params, 'bot_fixed', 'crm')
    returning id into v_msg;
  exception when others then
    v_motivo := coalesce(substring(sqlerrm from '^Envio recusado: ([a-z0-9_]+)'), 'falhou');
    return jsonb_build_object(
      'ok', false, 'motivo', v_motivo,
      'quando', case when v_motivo like 'janela%'
                     then app.janela_do_canal('whatsapp'::app.channel, now(), false) ->> 'abre_em' end);
  end;

  update public.portal_leads
     set conversation_id = v_conv,
         organization_id = coalesce(organization_id, v_org),
         responsavel_id  = coalesce(responsavel_id, auth.uid()),
         situacao        = case when situacao = 'novo' then 'em_atendimento' else situacao end,
         situacao_em     = case when situacao = 'novo' then now() else situacao_em end,
         situacao_por    = case when situacao = 'novo' then auth.uid() else situacao_por end
   where id = l.id;

  insert into public.activities (type, organization_id, deal_id, user_id, author_kind, body, metadata)
  values ('system', v_org, app.wa_negocio_da_ficha(v_org), auth.uid(), 'system',
          'Chamado com a IA pelo lead do portal: "' || v_corpo || '"',
          jsonb_build_object('origin', 'chamar_com_a_ia', 'portal_lead_id', l.id, 'message_id', v_msg));
  insert into public.audit_log (actor_id, actor_role, action, table_name, row_id, old_data, new_data)
  values (auth.uid(), app.role()::text, 'UPDATE', 'portal_leads', l.id::text,
          jsonb_build_object('situacao', l.situacao, 'conversation_id', null),
          jsonb_build_object('chamado_com_a_ia', true, 'conversation_id', v_conv, 'message_id', v_msg));

  return jsonb_build_object('ok', true, 'conversation_id', v_conv, 'message_id', v_msg,
                            'organization_id', v_org, 'texto', v_corpo);
end $$;
comment on function public.portal_lead_chamar(uuid, text, text) is
  'Chamar com a IA (admin, gestor e SDR): manda ao lead do portal sem conversa o modelo IMV-LEAD-PORTAL com o nome e o trecho do imóvel conferidos, como mensagem automática (a IA assume a resposta). Liga ou cria a ficha (app.portal_lead_ligar_ficha), abre a conversa pela porteira de sempre e liga o lead a ela ("em atendimento"). Recusa com motivo: sem permissão, impedimento do lead, modelo não aprovado, nome ou imóvel inválido, supressão, horário (com "quando"), tetos.';
revoke all on function public.portal_lead_chamar(uuid, text, text) from public, anon;
grant execute on function public.portal_lead_chamar(uuid, text, text) to authenticated;

  $ddl$;
end $chamar$;

notify pgrst, 'reload schema';

-- A abertura fica livre: o modelo deixa de escrever no lugar de quem manda.
--
-- Pedido do Rafael em 16/09/2026, depois do primeiro envio de verdade: "não quero
-- ter modelo preso, preciso fazer o contato inicial de modo livre".
--
-- O que é regra da META e não dá para mudar: fora da janela de 24 h, quem começa a
-- conversa só manda texto que a Meta aprovou. O que dá para fazer — e é o que esta
-- migração faz — é aprovar uma MOLDURA: saudação com o nome de quem envia, o espaço
-- livre no meio (`{{mensagem}}`) e a saída obrigatória (SAIR + aviso de privacidade,
-- RF-CON-12). Dentro da moldura, cada contato é escrito na hora, do jeito que a
-- pessoa quiser.
--
-- Vão quatro modelos:
--   * GEN-ABR-LIVRE      — a moldura mínima: saudação, o seu texto, a saída.
--   * GEN-ABR-PARCERIA   — a abertura que o Rafael já usa à mão (parceria com
--                          divulgação gratuita, prova social em {{referencias}},
--                          convite para 20 minutos), pronta para disparar.
--   * GEN-ABR-LANCAMENTO — a mesma com data e lugar do lançamento em variável, para
--                          não envelhecer dentro do modelo.
--   * GEN-FUP-LIVRE      — a retomada livre, para quando a janela de 24 h fechou.
--
-- E o teto de 200 caracteres por variável sobe para 900 nas variáveis de texto livre.


-- =====================================================================
-- A. O teto de cada variável
-- =====================================================================
-- 200 caracteres servem para nome, empresa e origem. Não servem para o texto que
-- a pessoa escreve: era o teto que prendia a abertura num modelo pronto. A Graph
-- API aceita até 1024 por parâmetro; o CRM para em 900 para sobrar margem, e a
-- limpeza de quebra de linha continua (a Meta recusa parâmetro com \n).
create or replace function app.modelo_teto_da_variavel(p_variavel text)
returns int
language sql
immutable
set search_path = ''
as $$
  select case when p_variavel in ('mensagem', 'texto', 'recado') then 900 else 200 end
$$;
comment on function app.modelo_teto_da_variavel(text) is
  'Quantos caracteres cabem numa variável de modelo. As variáveis de texto livre (mensagem, texto, recado) vão até 900; o resto continua em 200.';
revoke all on function app.modelo_teto_da_variavel(text) from public, anon;
grant execute on function app.modelo_teto_da_variavel(text) to authenticated, service_role;

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
    elsif length(v_valor) > app.modelo_teto_da_variavel(v_var) then
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

  -- C.2: a primeira mensagem conta no funil. Falha aqui não barra o envio.
  if v_primeiro then
    begin
      perform app.wa_envio_no_funil(o.id, t.template_code);
    exception when others then
      raise warning 'wa_envio_no_funil(%): %', o.id, sqlerrm;
    end;
  end if;

  return jsonb_build_object('ok', true, 'conversation_id', v_conv, 'message_id', v_msg,
                            'primeiro_contato', v_primeiro, 'corpo', v_corpo);
end $$;
comment on function public.wa_enviar_modelo(uuid, int, jsonb) is
  'Envia um modelo de mensagem para o WhatsApp de uma ficha: acha ou cria a conversa, exige valor para toda variável (com o teto de app.modelo_teto_da_variavel), exige aprovação da Meta fora da janela de 24 h e enfileira a mensagem assinada por quem clicou. A primeira mensagem registra o contato e anda o negócio (app.wa_envio_no_funil). Supressão, horário e tetos são do messages_guard.';
revoke all on function public.wa_enviar_modelo(uuid, int, jsonb) from public, anon;
grant execute on function public.wa_enviar_modelo(uuid, int, jsonb) to authenticated;


-- =====================================================================
-- B. As aberturas novas
-- =====================================================================
insert into public.message_templates
  (template_code, name, channel, category, segment, kind, language, body, variables)
values
  ('GEN-ABR-LIVRE', 'Abertura livre — você escreve o meio', 'whatsapp', 'marketing', 'GEN',
   'abertura', 'pt_BR',
   'Oi, {{nome}}! Aqui é {{atendente}}, da Komune, o aplicativo de eventos de Natal. {{mensagem}} Se não for o momento, é só responder SAIR que eu não escrevo mais. Como usamos seus dados: komune.app.br/privacidade',
   '["atendente", "mensagem", "nome"]'::jsonb),
  ('GEN-ABR-PARCERIA', 'Abertura — parceria com divulgação gratuita', 'whatsapp', 'marketing', 'GEN',
   'abertura', 'pt_BR',
   'Oi, {{nome}}! Aqui é {{atendente}}, da Komune, um aplicativo novo de Natal para organizar eventos: num lugar só dá para montar o evento, contratar os fornecedores e pagar. Queria propor uma parceria com divulgação gratuita para {{empresa}}. Já estão com a gente {{referencias}}, e agora estamos escolhendo os primeiros parceiros. Posso te passar os detalhes, ou prefere marcar 20 minutos por vídeo? Se não for o momento, responda SAIR. Como usamos seus dados: komune.app.br/privacidade',
   '["atendente", "empresa", "nome", "referencias"]'::jsonb),
  ('GEN-ABR-LANCAMENTO', 'Abertura — lançamento com data e lugar', 'whatsapp', 'marketing', 'GEN',
   'abertura', 'pt_BR',
   'Oi, {{nome}}! Aqui é {{atendente}}, da Komune, o aplicativo de eventos de Natal. Nosso lançamento é {{quando}}, {{onde}}, e estamos fechando a lista dos primeiros parceiros — a divulgação de {{empresa}} no aplicativo é gratuita. Dá para conversar 20 minutos por vídeo, ou eu passo aí? Se não for o momento, responda SAIR. Como usamos seus dados: komune.app.br/privacidade',
   '["atendente", "empresa", "nome", "onde", "quando"]'::jsonb),
  ('GEN-FUP-LIVRE', 'Retomada livre — você escreve o meio', 'whatsapp', 'marketing', 'GEN',
   'followup', 'pt_BR',
   'Oi, {{nome}}! Aqui é {{atendente}}, da Komune. {{mensagem}} Se preferir que eu não escreva mais, responda SAIR. Como usamos seus dados: komune.app.br/privacidade',
   '["atendente", "mensagem", "nome"]'::jsonb)
on conflict (template_code) do nothing;

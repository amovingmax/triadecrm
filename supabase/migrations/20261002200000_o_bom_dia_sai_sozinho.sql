-- =====================================================================
-- O "Bom dia!" sai sozinho para quem foi aprovado no Google Maps
--
-- Rafael, 28/09/2026: "todo mundo que for aprovado do scrapper do google maps,
-- é para ser enviado o bom dia automaticamente, ou boa tarde... e etc, se a
-- pessoa responder o bom dia, ai a IA novamente após ja ter mandado o bom dia,
-- responde com a introdução, se a introdução obtiver resposta, ai continua com
-- humano".
--
-- Dos três elos, dois já existiam: a introdução responde quem respondeu
-- (20261002090000) e a conversa fica esperando gente na fila do Meu dia
-- (20261002180000). Faltava o PRIMEIRO — aprovar no Radar e o cumprimento sair
-- sem ninguém clicar em Envios.
--
-- ===========================================================================
-- NÃO NASCE MÁQUINA NOVA
-- ===========================================================================
-- O disparo em lote (20260921100000) já tem tudo o que este elo precisa: ritmo
-- por hora com intervalo sorteado, espera quando bate no teto ou fecha a
-- janela, cortesia de 72 h, parada automática quando 3+ pessoas pedem para sair
-- e passa de 2% (RF-CON-10), e a porteira de sempre conferindo supressão,
-- horário, domingo, feriado e teto do dia. Duplicar qualquer uma dessas regras
-- aqui seria criar uma segunda verdade que um dia diverge da primeira.
--
-- Então o lote ganha DUAS coisas, e nada mais:
--
--   1. `assinatura = 'komune'` — o lote SEM CRACHÁ. Rafael, no mesmo dia:
--      "n sai do cracha de ninguem, sai no da komune sem id". A mensagem sai
--      como `author_kind = 'bot_fixed'` e `sent_by = null`, que é exatamente o
--      que a introdução automática já faz. Não é detalhe de contabilidade:
--      ninguém clicou, então atribuir a mensagem a uma pessoa seria mentira, e
--      a conversa cairia no "Meu dia" de quem nunca decidiu nada sobre ela.
--      (A conversa continua tendo dono — RF-CON-04 exige, e
--      `conversations_before_write` preenche com `inbox.responsavel_padrao`.
--      Dono da CONVERSA e autor da MENSAGEM são coisas diferentes.)
--
--   2. `continuo` — o lote QUE NÃO ACABA. O lote comum congela a lista quando é
--      criado e se dá por concluído quando ela termina. Este espera: quem for
--      aprovado depois entra na fila e sai na vez dele.
--
-- ===========================================================================
-- O QUE DISPARA, E O QUE NÃO
-- ===========================================================================
-- O gatilho é o NASCIMENTO DA FICHA com origem `google_maps_raspado` — que é o
-- momento exato da aprovação, porque candidato reprovado não vira ficha. Fica
-- de fora tudo o que tem outra origem (planilha, cadastro à mão), por decisão
-- do Rafael hoje: "só o que vem do Google Maps".
--
-- E sai DESLIGADO: `atendimento.cumprimento_automatico = false`. Isto manda
-- mensagem de WhatsApp para gente de verdade sem ninguém apertar botão; quem
-- liga é uma pessoa, olhando.
--
-- RF-CON-02, RF-CON-10, RF-CON-11, RF-RAD-06 · ADR-05, ADR-06
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. A chave, desligada
-- ---------------------------------------------------------------------
update public.app_settings
   set value = value || '{"cumprimento_automatico": false}'::jsonb
 where key = 'atendimento' and not (value ? 'cumprimento_automatico');

-- Quantos por hora o lote da casa tenta. Seis é um a cada dez minutos: o teto
-- do dia (`app.wa_teto_da_meta`) é quem manda de verdade, e este número só
-- espalha os envios dentro do dia em vez de despejá-los às 8h01.
update public.app_settings
   set value = value || '{"cumprimento_por_hora": 6}'::jsonb
 where key = 'atendimento' and not (value ? 'cumprimento_por_hora');

-- ---------------------------------------------------------------------
-- 2. O lote pode ser da casa, e pode não acabar
-- ---------------------------------------------------------------------
alter table public.envios_em_massa
  add column if not exists continuo boolean not null default false;
comment on column public.envios_em_massa.continuo is
  'Lote que não se conclui quando a fila esvazia: espera quem entrar depois. Hoje só o cumprimento automático do Google Maps (28/09/2026).';

alter table public.envios_em_massa drop constraint if exists envios_em_massa_assinatura_check;
alter table public.envios_em_massa
  add constraint envios_em_massa_assinatura_check
  check (assinatura in ('eu', 'responsavel', 'revezar', 'marca', 'komune'));

-- Lote da casa não tem criador nem assinante: ninguém clicou.
alter table public.envios_em_massa alter column criado_por drop not null;
alter table public.envios_em_massa drop constraint if exists envios_em_massa_tem_criador;
alter table public.envios_em_massa
  add constraint envios_em_massa_tem_criador
  check (criado_por is not null or assinatura = 'komune');
alter table public.envios_em_massa_itens alter column assinante_id drop not null;

-- Um só, e um só. Dois lotes contínuos vivos seriam dois cumprimentos para a
-- mesma pessoa aprovada — o teto do dia não salvaria disso, porque cada um
-- contaria o seu.
create unique index if not exists envios_em_massa_um_continuo
  on public.envios_em_massa (continuo)
  where continuo and status in ('agendado', 'enviando', 'pausado');

-- ---------------------------------------------------------------------
-- 3. O lote permanente, criado na primeira vez que faz falta
-- ---------------------------------------------------------------------
create or replace function app.cumprimento_lote()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id     uuid;
  v_modelo int;
  v_hora   int;
begin
  select id into v_id from public.envios_em_massa
   where continuo and status in ('agendado', 'enviando') limit 1;
  if v_id is not null then
    return v_id;
  end if;
  -- Pausado ou parado é decisão de gente: não se cria outro por cima.
  if exists (select 1 from public.envios_em_massa where continuo and status = 'pausado') then
    return null;
  end if;

  -- Qualquer um dos três serve de âncora: `app.modelo_da_hora` troca pelo do
  -- período na hora de cada envio, e é por isso que o lote não precisa saber
  -- se hoje é de manhã.
  select id into v_modelo from public.message_templates
   where template_code = 'GEN-ABR-OLA-MANHA' and is_active;
  if v_modelo is null then
    return null;
  end if;

  select greatest(1, least(60, coalesce((s.value ->> 'cumprimento_por_hora')::int, 6)))
    into v_hora from public.app_settings s where s.key = 'atendimento';

  insert into public.envios_em_massa
    (nome, tipo, modelo_id, assinatura, por_hora, continuo, criado_por, status)
  values ('Cumprimento automático — Google Maps', 'modelo', v_modelo, 'komune',
          coalesce(v_hora, 6), true, null, 'agendado')
  returning id into v_id;
  return v_id;
end $$;
comment on function app.cumprimento_lote() is
  'O lote contínuo do cumprimento automático: devolve o que está vivo, ou cria o primeiro. Devolve null quando alguém pausou o lote (decisão de gente não se atropela) ou quando o modelo do cumprimento não existe.';
revoke all on function app.cumprimento_lote() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. Ficha nova do Google Maps entra na fila
-- ---------------------------------------------------------------------
create or replace function app.organizations_cumprimento()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lote uuid;
begin
  if not app.atendimento_liga('cumprimento_automatico') then
    return new;
  end if;
  if new.deleted_at is not null or new.do_not_contact then
    return new;
  end if;
  if not exists (select 1 from public.sources s
                  where s.id = new.source_id and s.slug = 'google_maps_raspado') then
    return new;
  end if;

  v_lote := app.cumprimento_lote();
  if v_lote is null then
    return new;
  end if;

  -- `assinante_id` nulo é o que diz "da casa"; `on conflict` é a idempotência
  -- (a mesma ficha não entra duas vezes no mesmo lote, e a chave única da
  -- tabela é quem garante, não uma conferência que corre junto).
  insert into public.envios_em_massa_itens (envio_id, posicao, organization_id, assinante_id)
  select v_lote,
         coalesce((select max(i.posicao) from public.envios_em_massa_itens i
                    where i.envio_id = v_lote), 0) + 1,
         new.id, null
  on conflict (envio_id, organization_id) do nothing;

  return new;
end $$;
comment on function app.organizations_cumprimento() is
  'Aprovou um candidato do Google Maps (que é o que faz a ficha nascer com essa origem) → a ficha entra na fila do cumprimento automático. Desligado por padrão em app_settings.atendimento.cumprimento_automatico.';
revoke all on function app.organizations_cumprimento() from public, anon, authenticated;

drop trigger if exists organizations_cumprimento on public.organizations;
create trigger organizations_cumprimento
  after insert on public.organizations
  for each row execute function app.organizations_cumprimento();

-- ---------------------------------------------------------------------
-- 5. O envio sem crachá
-- ---------------------------------------------------------------------
-- É `public.wa_enviar_modelo` menos a pessoa: acha ou cria a conversa, exige a
-- aprovação da Meta (fora da janela de 24 h só template atravessa) e enfileira
-- a mensagem como robô. Levanta exceção com a mesma frase que a porteira usa,
-- porque é dela que `app.envios_em_massa_rodar` lê o motivo da espera.
create or replace function app.wa_komune_abrir(p_organization_id uuid, p_template_id int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o          public.organizations%rowtype;
  t          public.message_templates%rowtype;
  v_numero   text := app.wa_numero_padrao();
  v_tel      text;
  v_ct       uuid;
  v_conv     uuid;
  v_msg      uuid;
  v_primeiro boolean;
begin
  select * into o from public.organizations where id = p_organization_id and deleted_at is null;
  if not found then
    raise exception 'Envio recusado: ficha_inexistente' using errcode = 'P0002';
  end if;
  if v_numero is null then
    raise exception 'Envio recusado: whatsapp_nao_configurado (RF-CON-01)' using errcode = '42501';
  end if;

  select * into t from public.message_templates
   where id = p_template_id and is_active and channel = 'whatsapp'::app.channel;
  if not found then
    raise exception 'Envio recusado: modelo_inexistente' using errcode = '42501';
  end if;
  -- Sem alguém para preencher `{{atendente}}` ou `{{nome}}`, um modelo com
  -- variável sairia com a chave crua no texto. O cumprimento não tem nenhuma.
  if cardinality(app.modelo_variaveis(t.body)) > 0 then
    raise exception 'Envio recusado: modelo_com_variavel_sem_assinante' using errcode = '42501';
  end if;

  select d.telefone, d.contact_id into v_tel, v_ct from app.wa_destino_da_ficha(o.id) d;
  if v_tel is null then
    raise exception 'Envio recusado: ficha_sem_whatsapp' using errcode = '42501';
  end if;

  select c.id into v_conv from public.conversations c
   where c.channel = 'whatsapp'::app.channel
     and c.business_number = v_numero and c.peer_phone_e164 = v_tel;
  if v_conv is null then
    -- `assignee_id` nulo de propósito: quem preenche é
    -- `conversations_before_write`, com o dono da ficha ou o responsável padrão
    -- (RF-CON-04). Escolher aqui seria dar a conversa a alguém que não pediu.
    insert into public.conversations (channel, business_number, peer_phone_e164,
                                      organization_id, contact_id, assignee_id, status)
    values ('whatsapp'::app.channel, v_numero, v_tel, o.id, v_ct, null, 'aguardando_parceiro')
    returning id into v_conv;
  else
    update public.conversations
       set organization_id = coalesce(organization_id, o.id),
           contact_id      = coalesce(contact_id, v_ct)
     where id = v_conv and (organization_id is null or contact_id is null);
  end if;

  if not app.janela_de_24h_aberta(v_conv, now())
     and not coalesce((app.wa_modelo_da_meta(t.id) ->> 'aprovado')::boolean, false) then
    raise exception 'Envio recusado: modelo_nao_aprovado_na_meta' using errcode = '42501';
  end if;

  -- `messages_guard` confere supressão, horário, domingo, feriado e os tetos, e
  -- recusa com exceção — que desfaz junto a conversa criada aqui em cima.
  insert into public.messages (conversation_id, direction, type, status, body,
                               template_id, template_params, author_kind, sent_by, origin)
  values (v_conv, 'out'::app.msg_direction, 'template'::app.msg_type, 'queued'::app.msg_status,
          t.body, t.id, '{}'::jsonb, 'bot_fixed', null, 'crm')
  returning id, is_first_contact into v_msg, v_primeiro;

  if v_primeiro then
    begin
      perform app.wa_envio_no_funil(o.id, t.template_code);
    exception when others then
      raise warning 'wa_envio_no_funil(%): %', o.id, sqlerrm;
    end;
  end if;

  return jsonb_build_object('ok', true, 'conversation_id', v_conv, 'message_id', v_msg,
                            'primeiro_contato', v_primeiro);
end $$;
comment on function app.wa_komune_abrir(uuid, int) is
  'Abre conversa em nome da Komune, sem assinante: o mesmo caminho de public.wa_enviar_modelo menos a pessoa. Mensagem como bot_fixed com sent_by nulo (28/09/2026: "n sai do cracha de ninguem"). Recusa modelo com variável, porque não há quem preencha. Supressão, horário e tetos continuam sendo do messages_guard.';
revoke all on function app.wa_komune_abrir(uuid, int) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 6. O item do lote: com crachá como sempre, sem crachá quando é da casa
-- ---------------------------------------------------------------------
-- Recriada inteira a partir de 20260922160000:130. O que muda são dois desvios
-- no começo e no meio; o resto — destino, cortesia de 72 h, montagem, voz da
-- marca, texto livre dentro da janela — é o de antes, palavra por palavra.
create or replace function app.envio_um(p_envio public.envios_em_massa, p_item public.envios_em_massa_itens)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_casa   boolean := p_envio.assinatura = 'komune';
  v_papel  text;
  v_mont   jsonb;
  v_ret    jsonb;
  v_numero text := app.wa_numero_padrao();
  v_tel    text;
  v_conv   uuid;
  v_msg    uuid;
begin
  -- O lote da casa não tem assinante para conferir. O que o confere é a
  -- porteira, que não pergunta quem mandou — pergunta se pode sair.
  if not v_casa then
    select p.role::text into v_papel from public.profiles p
     where p.id = p_item.assinante_id and p.is_active;
    if v_papel is null or v_papel not in ('admin', 'gestor', 'sdr', 'embaixador') then
      return jsonb_build_object('ok', false, 'motivo', 'assinante_sem_permissao');
    end if;
  end if;

  select d.telefone into v_tel from app.wa_destino_da_ficha(p_item.organization_id) d;
  if v_tel is null then
    return jsonb_build_object('ok', false, 'motivo', 'ficha_sem_whatsapp');
  end if;
  select c.id into v_conv from public.conversations c
   where c.channel = 'whatsapp'::app.channel and c.business_number = v_numero
     and c.peer_phone_e164 = v_tel;

  -- A cortesia vale para os dois: duas frias seguidas derrubam a nota do
  -- número, e o número é o mesmo.
  if v_conv is not null and exists (
       select 1 from public.messages m join public.conversations c on c.id = m.conversation_id
        where m.conversation_id = v_conv and m.direction = 'out'::app.msg_direction
          and m.status <> 'failed'::app.msg_status
          and coalesce(m.sent_at, m.created_at) > now() - interval '72 hours'
          and (c.last_inbound_at is null or coalesce(m.sent_at, m.created_at) > c.last_inbound_at)) then
    return jsonb_build_object('ok', false, 'motivo', 'mensagem_recente_sem_resposta');
  end if;

  -- ----- o lote da casa acaba aqui: sem crachá, sem voz, sem variável -----
  if v_casa then
    if p_envio.tipo <> 'modelo' then
      return jsonb_build_object('ok', false, 'motivo', 'lote_da_casa_so_manda_modelo');
    end if;
    v_ret := app.wa_komune_abrir(p_item.organization_id, app.modelo_da_hora(p_envio.modelo_id));
    return jsonb_build_object('ok', true, 'message_id', v_ret ->> 'message_id');
  end if;

  v_mont := app.envio_montar(p_envio.tipo, p_envio.modelo_id, p_envio.texto, p_envio.variaveis,
                             p_item.organization_id, p_item.assinante_id);
  if not (v_mont ->> 'ok')::boolean then
    return v_mont;
  end if;

  perform set_config('request.jwt.claims',
                     jsonb_build_object('sub', p_item.assinante_id, 'role', 'authenticated',
                                        'app_metadata', jsonb_build_object('app_role', v_papel))::text,
                     true);
  -- (20260921110000) A voz da marca vale até o fim desta volta do relógio.
  perform set_config('app.voz', case when p_envio.assinatura = 'marca' then 'marca' else '' end, true);

  if p_envio.tipo = 'modelo' then
    -- O cumprimento é o do período em que ESTE item sai.
    v_ret := public.wa_enviar_modelo(p_item.organization_id, app.modelo_da_hora(p_envio.modelo_id),
                                     v_mont -> 'parametros');
    v_msg := (v_ret ->> 'message_id')::uuid;
  else
    if v_conv is null or not app.janela_de_24h_aberta(v_conv, now()) then
      return jsonb_build_object('ok', false, 'motivo', 'sem_janela_24h');
    end if;
    insert into public.messages (conversation_id, direction, type, status, body,
                                 author_kind, sent_by, origin)
    values (v_conv, 'out'::app.msg_direction, 'text'::app.msg_type, 'queued'::app.msg_status,
            v_mont ->> 'corpo', 'human', p_item.assinante_id, 'crm')
    returning id into v_msg;
  end if;
  return jsonb_build_object('ok', true, 'message_id', v_msg);
end $$;

-- ---------------------------------------------------------------------
-- 7. O relógio: o lote contínuo espera em vez de se dar por concluído
-- ---------------------------------------------------------------------
-- Recriada inteira a partir de 20260921110000:514. Muda UM ramo: a fila vazia.
create or replace function app.envios_em_massa_rodar()
returns int
language plpgsql
security definer
set search_path = ''
as $$
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
    v_tent := 0;
    loop
      v_tent := v_tent + 1;
      exit when v_tent > 20;

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
        update public.envios_em_massa
           set status = 'enviando', atualizado_em = now(),
               proximo_em = now() + v_passo * (0.7 + random() * 0.6)
         where id = e.id;
        v_feitos := v_feitos + 1;
        exit;
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
end $$;

-- ---------------------------------------------------------------------
-- 8. O interruptor em Ajustes → Atendimento
-- ---------------------------------------------------------------------
-- Recriada a partir de 20261002090000:319, e pelo mesmo motivo do "NOVO" que
-- está lá: chave fora do laço é ignorada EM SILÊNCIO, e o gestor clica no
-- interruptor achando que ligou. `cumprimento_por_hora` entra junto porque é o
-- freio — quem liga isto pela primeira vez vai querer começar devagar, e trocar
-- o ritmo não pode exigir migração.
create or replace function public.atendimento_configurar(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_texto text := nullif(btrim(coalesce(p ->> 'texto_ausencia', '')), '');
  v_intro text := nullif(btrim(coalesce(p ->> 'texto_introducao', '')), '');
  v_hora  int  := nullif(btrim(coalesce(p ->> 'cumprimento_por_hora', '')), '')::int;
  v_novo  jsonb := '{}'::jsonb;
  k       text;
begin
  if auth.uid() is null or not app.is_manager() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  foreach k in array array['lead_automatico', 'distribuicao_automatica',
                           'ausencia_ativa', 'introducao_ativa',
                           'cumprimento_automatico'] loop
    if p ? k then
      if jsonb_typeof(p -> k) <> 'boolean' then
        return jsonb_build_object('ok', false, 'motivo', 'valor_invalido', 'campo', k);
      end if;
      v_novo := v_novo || jsonb_build_object(k, p -> k);
    end if;
  end loop;
  if v_hora is not null and (v_hora < 1 or v_hora > 60) then
    return jsonb_build_object('ok', false, 'motivo', 'valor_invalido',
                              'campo', 'cumprimento_por_hora');
  end if;
  if v_hora is not null then
    v_novo := v_novo || jsonb_build_object('cumprimento_por_hora', v_hora);
  end if;
  if v_texto is not null and length(v_texto) > 1000 then
    return jsonb_build_object('ok', false, 'motivo', 'texto_longo_demais');
  end if;
  if v_intro is not null then
    if length(v_intro) > 1000 then
      return jsonb_build_object('ok', false, 'motivo', 'texto_longo_demais',
                                'campo', 'texto_introducao');
    end if;
    if position('{{' in v_intro) > 0 then
      return jsonb_build_object('ok', false, 'motivo', 'introducao_com_variavel');
    end if;
  end if;

  update public.app_settings set value = value || v_novo, updated_by = auth.uid()
   where key = 'atendimento';
  if v_texto is not null then
    update public.message_templates set body = v_texto where template_code = 'GEN-SYS-AUSENCIA';
  end if;
  if v_intro is not null then
    update public.message_templates set body = v_intro where template_code = 'GEN-SYS-INTRO';
  end if;
  -- O lote que já está vivo aprende o ritmo novo agora, e não só no próximo que
  -- nascer: quem baixa de 6 para 2 está pisando no freio de um envio EM CURSO.
  if v_hora is not null then
    update public.envios_em_massa set por_hora = v_hora, atualizado_em = now()
     where continuo and status in ('agendado', 'enviando', 'pausado');
  end if;
  return jsonb_build_object('ok', true);
end $$;
comment on function public.atendimento_configurar(jsonb) is
  'Ajustes → Atendimento: os cinco interruptores (lead automático, distribuição, ausência, introdução e cumprimento automático do Google Maps), o ritmo do cumprimento (1 a 60 por hora, que também reajusta o lote em curso) e os dois textos automáticos. A introdução recusa variável porque o corpo dela é copiado cru para o fio (ADR-16).';

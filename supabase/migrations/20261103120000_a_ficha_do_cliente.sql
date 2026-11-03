-- =====================================================================
-- A ficha do cliente, que se preenche sozinha (03/11/2026)
--
-- Pedido do usuário para a Imova: "Todos os clientes que entrarem em contato
-- no CRM da Imova devem ter uma ficha dessa no seu perfil [...] de acordo com
-- a etapa em que ele se encontra, a ficha deverá preencher sozinha. Por
-- exemplo, Ana Souza mandou uma mensagem, o progresso atualiza e a próxima
-- ação mostra o que devemos fazer depois." A IA entra depois, lendo e
-- escrevendo na mesma ficha.
--
-- Três coisas, todas feitas pelo `pg_cron` de minuto em minuto:
--   1. A FICHA NASCE SOZINHA. Quem escreveu para o número da Imova e ainda
--      não é ficha ganha uma: tipo Cliente, categoria Comprador, funil
--      Clientes, origem "Chegou pelo WhatsApp", com o nome do perfil do
--      WhatsApp. Número que a base já conhece é LIGADO à ficha que já existe,
--      nunca duplicado (a mesma regra do cadastro rápido). Quem pediu para
--      sair, conversa bloqueada e número que não é telefone brasileiro ficam
--      sem ficha, como hoje.
--   2. A RÉGUA ANDA. A primeira mensagem do cliente já leva o negócio para
--      Respondeu (`app.wa_resposta_no_funil`, de 15/09); a visita marcada e a
--      realizada já andam pela agenda (`app.reuniao_gravar`, desfechos). O que
--      faltava: quem estava em Contatado, na etapa de entrada ou em Nutrição e
--      voltou a escrever vai para Respondeu.
--   3. A PRÓXIMA AÇÃO SE ESCREVE. `deals.next_action`/`next_action_at` — o
--      mesmo campo que o cabeçalho da ficha, o quadro e o Meu dia já leem —
--      passa a ser preenchido pela regra: "Responder a mensagem" quando o
--      cliente está esperando; "Retomar a conversa" quando quem espera somos
--      nós; "Fazer a visita", "Enviar a proposta"... conforme a etapa. A
--      próxima ação que alguém do time escreveu à mão vale até um fato novo
--      (o cliente escrever, a etapa mudar). `public.proximas_acoes_automaticas`
--      guarda o que a regra escreveu e por quê: é por ela que a tela diz
--      "automática", e é ali que a IA vai escrever quando entrar.
--
-- O WHATSAPP NÃO MUDA. Nenhum gatilho entra em `messages` nem em
-- `conversations`, e nada aqui grava mensagem, enfileira envio ou mexe em
-- janela, robô, ausência, opt-out ou atendente (`whatsapp-intocavel`; o
-- pgTAP 119 prova). Ligar a conversa à ficha é o mesmo `update` do botão
-- "Ligar a uma ficha" (`public.vincular_conversa`), sem a sessão de ninguém.
--
-- SÓ DA IMOVA, como a atitude do cliente (20261029110000): no banco da KOMUNE
-- esta migração não cria nada; num banco sem identidade (db reset, CI) cria
-- tudo; e a regra só liga onde `app.identidade` = imova. A chave
-- `app_settings['ficha_automatica']` e o job do `pg_cron` vêm do seed da
-- Imova. A tela só mostra o que é dela onde o módulo existe
-- (`EMPRESA.modulos.fichaDoCliente`).
-- =====================================================================

do $ficha$
begin
  if (select i.empresa from app.identidade i) = 'komune' then
    raise notice 'A ficha automática do cliente é só da Imova: no banco da KOMUNE nada foi criado.';
    return;
  end if;
  execute $ddl$

-- =====================================================================
-- 1. Configuração
-- =====================================================================
create or replace function app.ficha_automatica_config()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select '{"ligada": false,
           "categoria": "comprador",
           "retomar_em_dias": 2,
           "retomar_sem_resposta_em_dias": 3,
           "acompanhar_em_dias": 3,
           "reativar_em_dias": 30}'::jsonb
         || coalesce((select s.value from public.app_settings s where s.key = 'ficha_automatica'), '{}'::jsonb)
         -- Fora da Imova, desligada sempre, diga o que disser a configuração.
         || case when (select i.empresa from app.identidade i) = 'imova' then '{}'::jsonb
                 else '{"ligada": false}'::jsonb end
$$;
comment on function app.ficha_automatica_config() is
  'A configuração da ficha automática do cliente, com os padrões por baixo de app_settings[''ficha_automatica'']. Só liga no banco da Imova (app.identidade): fora dela, ligada é sempre false.';
revoke all on function app.ficha_automatica_config() from public, anon;

-- O dia útil N dias depois, às 9h de Natal: quando a regra marca "retomar".
create or replace function app.proxima_acao_dia(p_base timestamptz, p_dias int)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select (app.next_business_day((p_base at time zone 'America/Fortaleza')::date,
                                greatest(coalesce(p_dias, 1), 1)) + time '09:00')
         at time zone 'America/Fortaleza'
$$;
revoke all on function app.proxima_acao_dia(timestamptz, int) from public, anon;


-- =====================================================================
-- 2. O que a regra escreveu
-- =====================================================================
create table if not exists public.proximas_acoes_automaticas (
  deal_id         uuid primary key references public.deals (id) on delete cascade,
  -- Qual regra escreveu: responder, retomar, primeiro_contato, marcar_visita,
  -- fazer_visita, registrar_visita, enviar_proposta, acompanhar_proposta,
  -- pedir_documentacao, acompanhar_documentacao, reativar. Duas não escrevem:
  -- 'manual' (a regra está respeitando a de alguém do time) e 'nenhuma' (não
  -- há passo a sugerir).
  regra           text not null check (regra ~ '^[a-z_]{3,40}$'),
  -- O que foi gravado em deals.next_action / next_action_at.
  texto           text not null,
  em              timestamptz,
  -- Por que, em uma frase: a tela mostra embaixo da próxima ação.
  motivo          text,
  -- Quem escreveu: hoje só a regra; a IA entra com 'ia'.
  autor           text not null default 'regra' check (autor in ('regra', 'ia')),
  gravada_em      timestamptz not null default now(),
  -- A próxima ação que alguém do time escreveu à mão, e desde quando a regra
  -- a vê. Ela vale até um fato mais novo que isso.
  manual_texto    text,
  manual_desde    timestamptz,
  calculada_em    timestamptz not null default now()
);
alter table public.proximas_acoes_automaticas enable row level security;
drop policy if exists proximas_acoes_automaticas_select on public.proximas_acoes_automaticas;
-- Quem vê o negócio vê o que a regra escreveu nele (a RLS de deals decide).
create policy proximas_acoes_automaticas_select on public.proximas_acoes_automaticas
  for select to authenticated
  using (exists (select 1 from public.deals d where d.id = proximas_acoes_automaticas.deal_id));
comment on table public.proximas_acoes_automaticas is
  'A próxima ação que a regra (e, depois, a IA) escreveu em cada negócio, com o porquê, e a próxima ação manual que ela está respeitando. Escrita só por app.proxima_acao_gravar (pg_cron), 03/11/2026, só da Imova.';

-- As conversas que não viraram ficha, e por quê: para o job não tentar de
-- novo a cada minuto quem não pode virar (suprimido, telefone estrangeiro).
-- Uma mensagem nova faz a conversa ser olhada outra vez.
create table if not exists app.ficha_automatica_recusas (
  conversation_id uuid primary key references public.conversations (id) on delete cascade,
  motivo          text not null,
  tentada_em      timestamptz not null default now()
);
comment on table app.ficha_automatica_recusas is
  'Conversas sem ficha que a ficha automática olhou e não pôde criar, com o motivo. Uma mensagem mais nova que tentada_em faz o job olhar de novo.';


-- =====================================================================
-- 3. A ficha nasce sozinha
-- =====================================================================
create or replace function app.cliente_ficha_criar(p_conversation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cfg   jsonb := app.ficha_automatica_config();
  c       public.conversations%rowtype;
  v_tel   text;
  v_org   uuid;
  v_ct    uuid;
  v_dono  uuid;
  v_cat   int;
  v_fonte int;
  v_pipe  int;
  v_etapa int;
  v_deal  uuid;
  v_resp  uuid;
  v_criou boolean := false;
begin
  if not coalesce((v_cfg ->> 'ligada')::boolean, false) then
    return jsonb_build_object('ok', false, 'motivo', 'desligada');
  end if;

  select * into c from public.conversations where id = p_conversation_id;
  if not found or c.channel <> 'whatsapp'::app.channel then
    return jsonb_build_object('ok', false, 'motivo', 'conversa_inexistente');
  end if;
  -- Nunca esperar pelo motor do WhatsApp: se a conversa está sendo escrita
  -- agora (mensagem chegando), fica para o próximo minuto.
  perform 1 from public.conversations where id = c.id for update skip locked;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'ocupada', 'de_novo', true);
  end if;
  select * into c from public.conversations where id = p_conversation_id;
  if c.organization_id is not null then
    return jsonb_build_object('ok', false, 'motivo', 'ja_tem_ficha', 'organization_id', c.organization_id);
  end if;
  if c.bloqueada_em is not null then
    return jsonb_build_object('ok', false, 'motivo', 'bloqueada');
  end if;
  -- "Entrou em contato": a pessoa escreveu. Conversa que só o time abriu
  -- (modelo para quem ainda não respondeu) espera a resposta.
  select m.id into v_resp
    from public.messages m
   where m.conversation_id = c.id and m.direction = 'in'::app.msg_direction
     and m.type <> 'system'::app.msg_type
   order by m.created_at, m.id
   limit 1;
  if v_resp is null then
    return jsonb_build_object('ok', false, 'motivo', 'nao_escreveu');
  end if;

  v_tel := app.normalize_phone_br(c.peer_phone_e164);
  if v_tel is null then
    return jsonb_build_object('ok', false, 'motivo', 'telefone_invalido');
  end if;
  if app.is_suppressed(v_tel, null, null) then
    return jsonb_build_object('ok', false, 'motivo', 'telefone_suprimido');
  end if;

  -- O número que a base já conhece — da ficha ou de uma pessoa ligada a ela —
  -- é LIGADO, nunca duplicado (as regras de `quick_create_organization`).
  select o.id into v_org from public.organizations o
   where o.phone_e164 = v_tel and o.deleted_at is null
   limit 1;
  if v_org is null then
    select oc.organization_id into v_org
      from public.contacts ct
      join public.organization_contacts oc on oc.contact_id = ct.id
      join public.organizations o on o.id = oc.organization_id and o.deleted_at is null
     where ct.phone_e164 = v_tel and ct.deleted_at is null
     order by oc.is_primary desc
     limit 1;
  end if;

  if v_org is null then
    select ca.id into v_cat from public.categories ca
     where ca.slug = coalesce(v_cfg ->> 'categoria', 'comprador') and ca.is_active;
    select s.id into v_fonte from public.sources s where s.slug = 'whatsapp_entrada' and s.is_enabled;
    select p.id into v_pipe from public.pipelines p where p.slug = 'produtor';
    select st.id into v_etapa from public.stages st
     where st.pipeline_id = v_pipe and st.is_entry and st.retired_at is null
     order by st.position limit 1;
    if v_cat is null or v_fonte is null or v_etapa is null then
      return jsonb_build_object('ok', false, 'motivo', 'catalogo_incompleto');
    end if;

    -- Quem atende a conversa responde pela ficha, se ainda está no time e atende.
    select p.id into v_dono from public.profiles p
     where p.id = c.assignee_id and p.is_active
       and p.role in ('admin'::app.user_role, 'gestor'::app.user_role, 'sdr'::app.user_role);

    -- Pessoa física: quem escreve para a imobiliária é, quase sempre, alguém
    -- procurando imóvel, e a ficha não pede CNPJ (a empresa que escrever é
    -- corrigida em "Editar ficha").
    insert into public.organizations (kind, name, phone_e164, source_id, collected_at, collector,
                                      owner_id, is_natural_person)
    values ('produtor'::app.org_kind,
            coalesce(nullif(btrim(coalesce(c.peer_nome, '')), ''),
                     'Cliente ' || app.telefone_legivel(v_tel)),
            v_tel, v_fonte, now(), 'ficha automática do cliente', v_dono, true)
    returning id into v_org;
    insert into public.organization_categories (organization_id, category_id, is_primary)
    values (v_org, v_cat, true);
    -- A próxima ação fica para a regra (abaixo): ela sabe se é responder agora.
    insert into public.deals (organization_id, pipeline_id, stage_id, owner_id, source_id)
    values (v_org, v_pipe, v_etapa, v_dono, v_fonte)
    returning id into v_deal;
    insert into public.activities (type, organization_id, deal_id, user_id, author_kind, body, metadata)
    values ('system', v_org, v_deal, null, 'system',
            'Ficha criada sozinha: o cliente escreveu pelo WhatsApp',
            jsonb_build_object('origin', 'ficha_automatica', 'conversation_id', c.id));
    v_criou := true;
  end if;

  -- Ligar a conversa: o que `public.vincular_conversa` faz, sem sessão.
  select ct.id into v_ct
    from public.organization_contacts oc
    join public.contacts ct on ct.id = oc.contact_id and ct.deleted_at is null
   where oc.organization_id = v_org and ct.phone_e164 = v_tel
   limit 1;
  update public.conversations
     set organization_id = v_org, contact_id = coalesce(contact_id, v_ct)
   where id = c.id;
  update public.messages set organization_id = v_org
   where conversation_id = c.id and organization_id is null;
  update public.organizations x
     set phone_e164 = v_tel
   where x.id = v_org and x.phone_e164 is null
     and not exists (select 1 from public.organizations y
                      where y.phone_e164 = v_tel and y.deleted_at is null);
  if not v_criou then
    insert into public.activities (type, organization_id, deal_id, user_id, author_kind, body, metadata)
    values ('system', v_org, app.wa_negocio_da_ficha(v_org), null, 'system',
            'Conversa de WhatsApp ligada sozinha a esta ficha (o número já era dela)',
            jsonb_build_object('origin', 'ficha_automatica', 'conversation_id', c.id));
  end if;

  -- A primeira mensagem dela conta no funil: "Respondeu" (15/09/2026).
  begin
    perform app.wa_resposta_no_funil(v_resp);
  exception when others then
    raise warning 'wa_resposta_no_funil(%): %', v_resp, sqlerrm;
  end;

  delete from app.ficha_automatica_recusas where conversation_id = c.id;
  return jsonb_build_object('ok', true, 'organization_id', v_org, 'criada', v_criou);
end $$;
comment on function app.cliente_ficha_criar(uuid) is
  'Dá ficha a quem escreveu de um número fora da base (só Imova): Cliente, Comprador, funil Clientes, origem "Chegou pelo WhatsApp", ou liga a conversa à ficha que já tem o número. Não envia nada.';
revoke all on function app.cliente_ficha_criar(uuid) from public, anon, authenticated;


-- =====================================================================
-- 4. A régua anda quando o cliente volta a escrever
-- =====================================================================
-- Contatado, etapa de entrada e Nutrição: o cliente escreveu DEPOIS de o
-- negócio entrar ali, então ele respondeu. Só para a frente, só destas três:
-- negócio em visita, proposta, ganho ou perdido não é tocado.
create or replace function app.cliente_etapa_andar(p_deal_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  d        record;
  v_alvo   int;
  v_entrou timestamptz;
begin
  select dl.id, dl.organization_id, dl.pipeline_id, dl.stage_id, dl.status, dl.entered_stage_at,
         s.slug, s.is_entry, s.is_dormant
    into d
    from public.deals dl join public.stages s on s.id = dl.stage_id
   where dl.id = p_deal_id
     and dl.status in ('open'::app.deal_status, 'nurturing'::app.deal_status);
  if not found or not (d.is_entry or d.is_dormant or d.slug = 'contatado') then
    return false;
  end if;
  if app.is_suppressed_target(d.organization_id, null) then
    return false;
  end if;
  select max(m.created_at) into v_entrou
    from public.messages m
    join public.conversations c on c.id = m.conversation_id
   where c.organization_id = d.organization_id
     and m.direction = 'in'::app.msg_direction and m.type <> 'system'::app.msg_type;
  if v_entrou is null or v_entrou <= d.entered_stage_at then
    return false;
  end if;
  select s.id into v_alvo from app.stage_for(d.pipeline_id, 'respondeu') s;
  if v_alvo is null or v_alvo = d.stage_id then
    return false;
  end if;
  update public.deals
     set stage_id = v_alvo,
         stage_change_reason = case when d.is_dormant then 'O cliente voltou a escrever pelo WhatsApp'
                                    else 'O cliente escreveu pelo WhatsApp' end
   where id = d.id;
  return true;
end $$;
comment on function app.cliente_etapa_andar(uuid) is
  'Leva para Respondeu o negócio em Contatado, na etapa de entrada ou em Nutrição cujo cliente escreveu depois de o negócio entrar ali. Só Imova (chamada pelo job da ficha automática).';
revoke all on function app.cliente_etapa_andar(uuid) from public, anon, authenticated;


-- =====================================================================
-- 5. A próxima ação
-- =====================================================================
-- Funil Clientes (produtor) e Captação de imóveis (fornecedor) usam o mesmo
-- caminho com palavras diferentes: visita × avaliação, proposta × documentação.
create or replace function app.proxima_acao_calcular(p_deal_id uuid, p_agora timestamptz default now())
returns table (regra text, texto text, em timestamptz, motivo text)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_cfg      jsonb := app.ficha_automatica_config();
  d          record;
  v_cliente  boolean;
  v_entrada  timestamptz;   -- última mensagem do cliente
  v_nossa    timestamptz;   -- última mensagem de gente do time que saiu
  v_primeiro text;
  r          record;
begin
  select dl.id, dl.organization_id, dl.status, dl.entered_stage_at, dl.created_at,
         s.slug, s.is_entry, s.is_dormant, s.is_lost, s.is_won, s.is_optout, p.slug as funil,
         o.name, o.do_not_contact
    into d
    from public.deals dl
    join public.stages s on s.id = dl.stage_id
    join public.pipelines p on p.id = dl.pipeline_id
    join public.organizations o on o.id = dl.organization_id and o.deleted_at is null
   where dl.id = p_deal_id;
  if not found
     or d.status not in ('open'::app.deal_status, 'nurturing'::app.deal_status)
     or d.is_lost or d.is_won or d.is_optout or d.do_not_contact
     or app.is_suppressed_target(d.organization_id, null) then
    return;
  end if;
  v_cliente := d.funil = 'produtor';
  v_primeiro := nullif(split_part(btrim(d.name), ' ', 1), '');

  -- As mensagens, como a atitude do cliente as lê: aviso do WhatsApp não é
  -- ninguém falando, e mensagem que não saiu (fila, falha) não é "nós falamos".
  select max(m.created_at) filter (where m.direction = 'in'),
         max(m.created_at) filter (where m.direction = 'out' and m.author_kind = 'human'
                                     and m.status not in ('queued', 'failed')
                                     and m.type not in ('reaction', 'system'))
    into v_entrada, v_nossa
    from public.messages m
    join public.conversations c on c.id = m.conversation_id
   where c.organization_id = d.organization_id
     and m.created_at <= p_agora
     and m.type <> 'system';

  -- 1. O cliente está esperando: responder vem antes de tudo. Em Nutrição, só
  -- o que ele escreveu depois de o negócio ser posto lá (o de antes já foi
  -- olhado por quem decidiu esperar).
  if v_entrada is not null and (v_nossa is null or v_entrada > v_nossa)
     and not (d.is_dormant and v_entrada <= d.entered_stage_at) then
    regra := 'responder';
    texto := 'Responder a mensagem';
    em := v_entrada;
    motivo := coalesce(v_primeiro, 'O cliente') || ' escreveu e ainda não teve resposta';
    return next; return;
  end if;

  -- 2. Visita (ou avaliação) marcada: o compromisso é a próxima ação.
  select rn.inicio, rn.fim into r
    from public.reunioes rn
   where rn.organization_id = d.organization_id
     and rn.estado in ('a_confirmar', 'marcada', 'confirmada')
   order by (rn.fim > p_agora) desc, rn.inicio
   limit 1;
  if r.inicio is not null then
    if r.fim > p_agora then
      regra := 'fazer_visita';
      texto := case when v_cliente then 'Fazer a visita' else 'Fazer a avaliação' end;
      em := r.inicio;
      motivo := case when v_cliente then 'Visita marcada na agenda' else 'Avaliação marcada na agenda' end;
    else
      regra := 'registrar_visita';
      texto := case when v_cliente then 'Registrar como foi a visita' else 'Registrar como foi a avaliação' end;
      em := r.fim;
      motivo := 'O horário passou e a agenda ainda não sabe como foi';
    end if;
    return next; return;
  end if;

  -- 3. Pela etapa.
  if d.is_dormant then
    regra := 'reativar';
    texto := 'Reativar com uma novidade';
    em := app.proxima_acao_dia(d.entered_stage_at, coalesce((v_cfg ->> 'reativar_em_dias')::int, 30));
    motivo := 'Em nutrição desde ' || to_char(d.entered_stage_at at time zone 'America/Fortaleza', 'DD/MM');
  elsif d.is_entry or d.slug = 'contatado' then
    if v_nossa is null and v_entrada is null then
      regra := 'primeiro_contato';
      texto := 'Primeiro contato';
      em := app.proxima_acao_dia(d.created_at, 1);
      motivo := 'Ainda ninguém falou com ' || coalesce(v_primeiro, 'esta pessoa');
    else
      regra := 'retomar';
      texto := 'Retomar a conversa';
      em := app.proxima_acao_dia(coalesce(v_nossa, d.entered_stage_at),
                                 coalesce((v_cfg ->> 'retomar_sem_resposta_em_dias')::int, 3));
      motivo := 'Mandamos mensagem e ' || coalesce(v_primeiro, 'a pessoa') || ' ainda não respondeu';
    end if;
  elsif d.slug = 'respondeu' then
    if v_nossa is null then
      regra := 'marcar_visita';
      texto := case when v_cliente then 'Marcar a visita' else 'Marcar a avaliação' end;
      em := app.proxima_acao_dia(d.entered_stage_at, 1);
      motivo := 'A conversa começou: o próximo passo é a ' || case when v_cliente then 'visita' else 'avaliação' end;
    else
      regra := 'retomar';
      texto := 'Retomar a conversa';
      em := app.proxima_acao_dia(v_nossa, coalesce((v_cfg ->> 'retomar_em_dias')::int, 2));
      motivo := 'Respondemos; se ' || coalesce(v_primeiro, 'a pessoa') || ' não voltar, retomar';
    end if;
  elsif d.slug in ('reuniao_marcada', 'demonstracao_marcada') then
    regra := 'marcar_visita';
    texto := case when v_cliente then 'Marcar a visita na agenda' else 'Marcar a avaliação na agenda' end;
    em := app.proxima_acao_dia(d.entered_stage_at, 1);
    motivo := 'A etapa diz que está marcada, mas a agenda não tem horário';
  elsif d.slug in ('apresentacao_realizada', 'demonstracao_realizada') then
    if v_cliente then
      regra := 'enviar_proposta';
      texto := 'Enviar a proposta';
      motivo := 'Visita feita: o próximo passo é a proposta';
    else
      regra := 'pedir_documentacao';
      texto := 'Pedir a documentação do imóvel';
      motivo := 'Avaliação feita: o próximo passo é a documentação';
    end if;
    em := app.proxima_acao_dia(d.entered_stage_at, 1);
  elsif d.slug in ('cadastro_em_andamento', 'parceria_aceita') then
    if v_cliente then
      regra := 'acompanhar_proposta';
      texto := 'Acompanhar a proposta';
      motivo := 'Proposta com o cliente';
    else
      regra := 'acompanhar_documentacao';
      texto := 'Acompanhar a documentação';
      motivo := 'Documentação em andamento';
    end if;
    em := app.proxima_acao_dia(greatest(d.entered_stage_at, coalesce(v_nossa, d.entered_stage_at)),
                               coalesce((v_cfg ->> 'acompanhar_em_dias')::int, 3));
  else
    return;
  end if;
  return next;
end $$;
comment on function app.proxima_acao_calcular(uuid, timestamptz) is
  'A próxima ação que a regra sugere para um negócio aberto (Imova): responder quem está esperando, a visita marcada, ou o passo da etapa. Só lê.';
revoke all on function app.proxima_acao_calcular(uuid, timestamptz) from public, anon, authenticated;

-- A próxima ação é da regra quando: não há nenhuma; é a que ela mesma
-- escreveu; ou é o "Primeiro contato" / "Responder no WhatsApp" que o
-- cadastro rápido e o lead automático põem ao nascer. Qualquer outra foi
-- escrita por alguém do time e vale até um fato mais novo que ela: o cliente
-- escrever, ou a etapa mudar.
create or replace function app.proxima_acao_gravar(p_deal_id uuid, p_agora timestamptz default now())
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  d        record;
  a        public.proximas_acoes_automaticas%rowtype;
  n        record;
  v_dela   boolean;
  v_fato   timestamptz;
begin
  if not coalesce((app.ficha_automatica_config() ->> 'ligada')::boolean, false) then
    return false;
  end if;
  -- O negócio que alguém está mexendo agora fica para o próximo minuto.
  select dl.id, dl.organization_id, dl.next_action, dl.next_action_at, dl.entered_stage_at
    into d from public.deals dl where dl.id = p_deal_id for update skip locked;
  if not found then return false; end if;
  select * into a from public.proximas_acoes_automaticas x where x.deal_id = p_deal_id;

  v_dela := d.next_action is null
            or (a.deal_id is not null
                and d.next_action is not distinct from a.texto
                and d.next_action_at is not distinct from a.em)
            or (a.deal_id is null and d.next_action in ('Primeiro contato', 'Responder no WhatsApp'));

  if not v_dela then
    -- Manual. A regra anota desde quando a vê, e só volta a escrever depois
    -- de um fato mais novo que isso.
    if a.deal_id is null or a.manual_texto is distinct from d.next_action or a.manual_desde is null then
      insert into public.proximas_acoes_automaticas as x
             (deal_id, regra, texto, em, manual_texto, manual_desde, calculada_em, gravada_em)
      values (p_deal_id, 'manual', coalesce(d.next_action, ''), d.next_action_at,
              d.next_action, p_agora, p_agora, p_agora)
      on conflict (deal_id) do update
        set manual_texto = excluded.manual_texto, manual_desde = excluded.manual_desde,
            calculada_em = excluded.calculada_em;
      return false;
    end if;
    select max(m.created_at) into v_fato
      from public.messages m join public.conversations c on c.id = m.conversation_id
     where c.organization_id = d.organization_id
       and m.direction = 'in'::app.msg_direction and m.type <> 'system'::app.msg_type;
    v_fato := greatest(v_fato, d.entered_stage_at);
    if v_fato is null or v_fato <= a.manual_desde then
      update public.proximas_acoes_automaticas set calculada_em = p_agora where deal_id = p_deal_id;
      return false;
    end if;
  end if;

  select * into n from app.proxima_acao_calcular(p_deal_id, p_agora) limit 1;
  if n.regra is null then
    -- Sem regra (não contatar, etapa sem passo seguinte): a regra não escreve
    -- nem apaga, e anota que olhou.
    insert into public.proximas_acoes_automaticas as x
           (deal_id, regra, texto, em, calculada_em, gravada_em)
    values (p_deal_id, 'nenhuma', '', null, p_agora, p_agora)
    on conflict (deal_id) do update set calculada_em = excluded.calculada_em;
    return false;
  end if;

  if d.next_action is distinct from left(n.texto, 200) or d.next_action_at is distinct from n.em then
    update public.deals set next_action = left(n.texto, 200), next_action_at = n.em
     where id = p_deal_id;
  end if;
  insert into public.proximas_acoes_automaticas as x
         (deal_id, regra, texto, em, motivo, autor, gravada_em, manual_texto, manual_desde, calculada_em)
  values (p_deal_id, n.regra, left(n.texto, 200), n.em, n.motivo, 'regra', p_agora, null, null, p_agora)
  on conflict (deal_id) do update
    set regra = excluded.regra, texto = excluded.texto, em = excluded.em, motivo = excluded.motivo,
        autor = excluded.autor,
        gravada_em = case when x.texto is distinct from excluded.texto or x.em is distinct from excluded.em
                            or x.regra = 'manual'
                          then excluded.gravada_em else x.gravada_em end,
        manual_texto = null, manual_desde = null, calculada_em = excluded.calculada_em;
  return d.next_action is distinct from left(n.texto, 200) or d.next_action_at is distinct from n.em;
end $$;
comment on function app.proxima_acao_gravar(uuid, timestamptz) is
  'Escreve em deals.next_action / next_action_at a próxima ação que a regra sugere, respeitando a manual até um fato mais novo (o cliente escrever, a etapa mudar). Devolve true quando mudou. Não envia nada.';
revoke all on function app.proxima_acao_gravar(uuid, timestamptz) from public, anon, authenticated;


-- =====================================================================
-- 6. O job de minuto em minuto
-- =====================================================================
create or replace function app.fichas_automaticas_rodar(p_limite int default 200)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lim   int := greatest(coalesce(p_limite, 200), 1);
  v_id    uuid;
  v_ret   jsonb;
  n_fic   int := 0;
  n_etapa int := 0;
  n_acao  int := 0;
begin
  if not coalesce((app.ficha_automatica_config() ->> 'ligada')::boolean, false) then
    return jsonb_build_object('ligada', false);
  end if;

  -- O que mudou é medido pela hora em que a linha foi ESCRITA (`updated_at`,
  -- que a mensagem nova também mexe na conversa), com uma folga: a mensagem
  -- que estava sendo gravada enquanto o job lia, e que ele não viu, ainda
  -- cai na conta das rodadas seguintes. A hora da mensagem (`created_at`) é a
  -- da Meta e pode ser anterior à rodada que não a viu.
  --
  -- 6.1 Fichas: quem escreveu e ainda não é ficha. Quem já foi recusado só
  -- volta a ser olhado com mensagem nova.
  for v_id in
    select c.id
      from public.conversations c
     where c.organization_id is null
       and c.channel = 'whatsapp'::app.channel
       and c.bloqueada_em is null
       and c.last_inbound_at is not null
       and not exists (select 1 from app.ficha_automatica_recusas r
                        where r.conversation_id = c.id
                          and r.tentada_em > c.updated_at + interval '5 minutes')
     order by c.last_inbound_at desc
     limit v_lim
  loop
    begin
      v_ret := app.cliente_ficha_criar(v_id);
    exception when others then
      v_ret := jsonb_build_object('ok', false, 'motivo', left('erro: ' || sqlerrm, 200));
      raise warning 'cliente_ficha_criar(%): %', v_id, sqlerrm;
    end;
    if coalesce((v_ret ->> 'ok')::boolean, false) then
      n_fic := n_fic + 1;
    elsif coalesce((v_ret ->> 'de_novo')::boolean, false) then
      null;  -- ocupada: o próximo minuto tenta, sem anotar recusa
    else
      insert into app.ficha_automatica_recusas (conversation_id, motivo, tentada_em)
      values (v_id, coalesce(v_ret ->> 'motivo', 'desconhecido'), now())
      on conflict (conversation_id) do update set motivo = excluded.motivo, tentada_em = excluded.tentada_em;
    end if;
  end loop;

  -- 6.2 A régua: quem voltou a escrever.
  for v_id in
    select dl.id
      from public.deals dl
      join public.stages s on s.id = dl.stage_id
     where dl.status in ('open'::app.deal_status, 'nurturing'::app.deal_status)
       and (s.is_entry or s.is_dormant or s.slug = 'contatado')
       and exists (select 1 from public.conversations c
                    where c.organization_id = dl.organization_id
                      and c.last_inbound_at > dl.entered_stage_at)
     limit v_lim
  loop
    begin
      if app.cliente_etapa_andar(v_id) then n_etapa := n_etapa + 1; end if;
    exception when others then
      raise warning 'cliente_etapa_andar(%): %', v_id, sqlerrm;
    end;
  end loop;

  -- 6.3 A próxima ação: os negócios abertos em que algo mudou desde a última
  -- conta (o negócio, uma mensagem, a agenda) e os que nunca foram olhados.
  for v_id in
    select dl.id
      from public.deals dl
      join public.organizations o on o.id = dl.organization_id and o.deleted_at is null
      left join public.proximas_acoes_automaticas a on a.deal_id = dl.id
     where dl.status in ('open'::app.deal_status, 'nurturing'::app.deal_status)
       and (a.deal_id is null
            or dl.updated_at > a.calculada_em - interval '5 minutes'
            or exists (select 1 from public.conversations c
                        where c.organization_id = dl.organization_id
                          and greatest(c.updated_at, c.last_message_at) > a.calculada_em - interval '5 minutes')
            or exists (select 1 from public.reunioes rn
                        where rn.organization_id = dl.organization_id
                          and (greatest(rn.atualizada_em, rn.criada_em) > a.calculada_em - interval '5 minutes'
                               -- a visita cujo horário acabou de passar
                               or (rn.fim <= now() and rn.fim > a.calculada_em - interval '5 minutes'))))
     order by dl.updated_at desc
     limit v_lim
  loop
    begin
      if app.proxima_acao_gravar(v_id) then n_acao := n_acao + 1; end if;
    exception when others then
      raise warning 'proxima_acao_gravar(%): %', v_id, sqlerrm;
    end;
  end loop;

  return jsonb_build_object('ligada', true, 'fichas', n_fic, 'etapas', n_etapa, 'proximas_acoes', n_acao);
end $$;
comment on function app.fichas_automaticas_rodar(int) is
  'O job da ficha automática do cliente (pg_cron, a cada minuto, agendado pelo seed da Imova): cria as fichas de quem escreveu, anda a régua de quem voltou a escrever e reescreve as próximas ações que mudaram. Desligada, devolve {"ligada": false} sem ler mais nada.';
revoke all on function app.fichas_automaticas_rodar(int) from public, anon, authenticated;

-- O agendamento de minuto em minuto NÃO é feito aqui: é do seed da Imova. Na
-- KOMUNE não há job nenhum.

  $ddl$;
end $ficha$;

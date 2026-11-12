-- =====================================================================
-- Disparos: cadastrar quem recebe ali mesmo, e ver a lista como ela é
--
-- Pedido de 12/11/2026, sobre a tela de Disparos: "quero que na tela de
-- disparo, eu consiga com mais clareza, cadastrar contatos, ver a mensagem
-- clara que vai ser enviada, ta bastante confuso, simplifique mais". O
-- protótipo escolhido ("B · Uma página, com o celular ao lado") tem a lista
-- "Quem recebe" sempre aberta, com três jeitos de encher: adicionar uma
-- pessoa, colar uma lista e escolher da base.
--
-- O banco já sabia escolher da base (`envio_em_massa_publico`) e montar a
-- prévia (`envio_em_massa_previa`). Faltavam três coisas:
--
--   1. `public.disparo_adicionar_contatos(jsonb)` — cadastra, de uma vez, as
--      pessoas digitadas ou coladas (até 500): nome, WhatsApp e, se houver,
--      a empresa. É o cadastro rápido de 04/09 (`quick_create_organization`)
--      sem a categoria obrigatória e COM a pessoa: quem cola "Mariana, 84
--      99999-0101" quer que a mensagem diga "Mariana", e o nome só chega à
--      mensagem pela pessoa principal da ficha (`app.wa_destino_da_ficha`).
--      Cada linha volta com o que aconteceu com ela, para a tela dizer em
--      português ("2 novas, 1 já estava na base, 1 pediu para não receber").
--      O que a base já conhece (a ficha ou uma pessoa ligada a uma) é
--      devolvido, nunca duplicado — as mesmas regras do cadastro rápido. Com
--      um cuidado a mais: "já estava" só quando a mensagem da ficha vai MESMO
--      para o número digitado. Se o número é de uma pessoa da ficha mas o
--      WhatsApp da ficha é outro, pôr a ficha no disparo mandaria a mensagem
--      para um número que ninguém digitou: a linha volta recusada
--      (`numero_de_outra_pessoa`), dizendo qual é a ficha.
--   2. `public.disparo_pessoas(uuid[])` — a lista "Quem recebe" como ela é:
--      a tela guarda só os ids, e os detalhes (nome, empresa, WhatsApp,
--      categoria, o que impede o envio — inclusive a conversa bloqueada no
--      CRM, de 27/10 — e o que vai fazer o disparo pular a pessoa) vêm daqui,
--      na ordem em que ela pediu. O telefone sai inteiro só para admin e
--      gestor; o SDR vê mascarado, como em toda a base (RF-BAS-14).
--   3. `public.envio_em_massa_teto()` passa a dizer também se a janela de
--      envio está aberta agora e, fechada, quando abre: a tela diz "começa a
--      sair amanhã às 8h" e mostra o cumprimento da hora em que vai sair.
--      Recriada a partir da definição viva (20261112100000); o resto não muda.
--
-- Telefone com cara de CPF ("849.881.601-40") é recusado como telefone
-- inválido: os 11 dígitos passariam por celular, e CPF não entra no CRM
-- (ADR-09).
--
-- O QUE NÃO MUDA: nada é enviado aqui. A ficha nova nasce na etapa de entrada
-- (Prospectado), sem bom-dia automático (esse só sai pelo botão da Revisão),
-- e a porteira de sempre (supressão, janela de horário, teto, cortesia de
-- 72 h, conversa bloqueada) continua decidindo no envio. Telefone suprimido
-- não ganha ficha.
--
-- COMO DESFAZER: `drop function public.disparo_adicionar_contatos(jsonb)`,
-- `drop function public.disparo_pessoas(uuid[])` e
-- `drop function app.disparo_numero_na_base(text)`; reaplicar
-- `public.envio_em_massa_teto` de 20261112100000. As fichas criadas ficam
-- (são fichas comuns, com a atividade "Parceiro criado pelo disparo").
--
-- RF-BAS-14, RF-BAS-15, RF-CON-02, RF-CON-11 · ADR-03, ADR-09
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. O que a base já sabe de um número
-- ---------------------------------------------------------------------
-- Uma conta só para a linha normal e para a corrida (outra pessoa do time
-- cadastrou o mesmo número no mesmo instante). `situacao` nula quer dizer
-- "pode criar"; `pessoa_id` é, nesse caso, a pessoa sem ficha viva que segura
-- o número (um telefone, uma pessoa), com o nome que ela tinha.
create or replace function app.disparo_numero_na_base(p_tel text,
                                                      out situacao      text,
                                                      out ficha_id      uuid,
                                                      out ficha         text,
                                                      out pessoa_id     uuid,
                                                      out nome_anterior text)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_org  uuid;
  v_ct   uuid;
  v_saiu boolean;
begin
  -- O número já é de uma ficha...
  select o.id into v_org
    from public.organizations o
   where o.phone_e164 = p_tel and o.deleted_at is null
   limit 1;
  -- ...ou de uma pessoa ligada a uma (dono, sócio): outra ficha seria o mesmo
  -- número com dois cartões e duas conversas (RF-BAS-15).
  if v_org is null then
    select oc.organization_id, c.id into v_org, v_ct
      from public.contacts c
      join public.organization_contacts oc on oc.contact_id = c.id
      join public.organizations o on o.id = oc.organization_id and o.deleted_at is null
     where c.phone_e164 = p_tel and c.deleted_at is null
     order by oc.is_primary desc, oc.created_at
     limit 1;
  end if;

  if v_org is null then
    -- Uma pessoa sem ficha viva (a ficha dela foi excluída) segura o número:
    -- é ela que vira a pessoa da ficha nova — a não ser que tenha pedido para
    -- não ser contatada.
    select c.id, c.do_not_contact, c.full_name into pessoa_id, v_saiu, nome_anterior
      from public.contacts c
     where c.phone_e164 = p_tel and c.deleted_at is null
     limit 1;
    if coalesce(v_saiu, false) then
      situacao := 'pediu_para_sair';
      pessoa_id := null;
      nome_anterior := null;
    end if;
    return;
  end if;

  if app.is_suppressed_target(v_org, v_ct) then
    situacao := 'pediu_para_sair';
  elsif not app.org_is_visible(v_org) then
    -- A dedup olha a base inteira, mas a ficha só é dita a quem já podia
    -- abri-la (a regra do cadastro rápido).
    situacao := 'telefone_de_outra_ficha';
  else
    select o.name into ficha from public.organizations o where o.id = v_org;
    -- "Já estava" só quando a mensagem da ficha vai para o número digitado.
    if (select d.telefone from app.wa_destino_da_ficha(v_org) d) is distinct from p_tel then
      situacao := 'numero_de_outra_pessoa';
    else
      situacao := 'ja_estava';
      ficha_id := v_org;
    end if;
  end if;
end $$;
comment on function app.disparo_numero_na_base(text) is
  'O que a base já sabe de um telefone (E.164), para o cadastro pelo disparo: pediu_para_sair, telefone_de_outra_ficha, numero_de_outra_pessoa (é de uma pessoa da ficha, mas o WhatsApp da ficha é outro), ja_estava (com a ficha), ou nulo (pode criar; com a pessoa sem ficha viva que segura o número, se houver). Só para public.disparo_adicionar_contatos.';
revoke all on function app.disparo_numero_na_base(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Cadastrar quem foi digitado ou colado
-- ---------------------------------------------------------------------
create or replace function public.disparo_adicionar_contatos(p_contatos jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := auth.uid();
  v_item     jsonb;
  v_linha    int;
  v_nome     text;
  v_empresa  text;
  v_tel      text;
  v_vistos   text[] := '{}'::text[];
  v_fonte    record;
  v_pipe     int;
  v_etapa    int;
  v_coletor  text;
  v_achado   record;
  v_org      uuid;
  v_contato  uuid;
  v_deal     uuid;
  v_status   text;
  v_devolve  uuid;
  v_ficha    text;
  v_itens    jsonb := '[]'::jsonb;
  v_novos    int := 0;
  v_ja       int := 0;
  v_recusas  int := 0;
begin
  -- DEVOLVE, não levanta, como o resto da tela de Disparos.
  if v_uid is null or not app.is_manager() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if p_contatos is null or jsonb_typeof(p_contatos) <> 'array'
     or jsonb_array_length(p_contatos) = 0 or jsonb_array_length(p_contatos) > 500 then
    return jsonb_build_object('ok', false, 'motivo', 'lista_invalida');
  end if;

  -- A origem: "contato pessoal" quando existe e está ligada (é o que é: alguém
  -- do time conhece a pessoa); senão a primeira origem ligada que seja manual
  -- ou de indicação. Sem nenhuma, a ficha não tem como nascer (a origem é
  -- obrigatória, RF-BAS-10) — e é melhor dizer isso antes da primeira linha.
  select s.id, s.slug, s.kind into v_fonte
    from public.sources s
   where s.slug = 'contato_pessoal' and s.is_enabled;
  if v_fonte.id is null then
    select s.id, s.slug, s.kind into v_fonte
      from public.sources s
     where s.is_enabled and s.kind in ('manual'::app.source_kind, 'referral'::app.source_kind)
     order by s.id
     limit 1;
  end if;
  if v_fonte.id is null then
    return jsonb_build_object('ok', false, 'motivo', 'sem_origem');
  end if;

  -- O funil de fornecedor e a etapa de entrada (07/10/2026: a ficha nasce
  -- nela e mora em Prospectados até a primeira mensagem). Sem funil ou sem
  -- etapa (a Imova não tem o de fornecedor), a ficha nasce sem negócio.
  select p.id into v_pipe from public.pipelines p where p.slug = 'fornecedor';
  select st.id into v_etapa
    from public.stages st
   where st.pipeline_id = v_pipe and st.is_entry and st.retired_at is null
   order by st.position
   limit 1;

  select coalesce(nullif(btrim(pr.full_name), ''), 'disparo') into v_coletor
    from public.profiles pr where pr.id = v_uid;
  v_coletor := coalesce(v_coletor, 'disparo');

  for v_item, v_linha in
    select e.value, e.n::int from jsonb_array_elements(p_contatos) with ordinality as e(value, n)
     order by e.n
  loop
    v_org     := null;
    v_contato := null;
    v_deal    := null;
    v_devolve := null;
    v_ficha   := null;
    -- Sem CPF no CRM (ADR-09): quem cola de planilha às vezes traz junto. No
    -- telefone, a forma de CPF é recusada inteira — os 11 dígitos de um CPF
    -- podem passar por celular, e mandar mensagem para eles seria pior.
    if jsonb_typeof(v_item) = 'object' then
      v_nome    := left(app.sem_cpf(regexp_replace(coalesce(v_item ->> 'nome', ''), '\s+', ' ', 'g')), 120);
      v_empresa := left(app.sem_cpf(regexp_replace(coalesce(v_item ->> 'empresa', ''), '\s+', ' ', 'g')), 120);
      v_tel     := case when coalesce(v_item ->> 'telefone', '') ~ '\d{3}\.\d{3}\.\d{3}-\d{2}' then null
                        else app.normalize_phone_br(v_item ->> 'telefone') end;
    else
      v_nome := null; v_empresa := null; v_tel := null;
    end if;

    if v_nome is null then
      v_status := 'nome_obrigatorio';
    elsif v_tel is null then
      v_status := 'telefone_invalido';
    elsif v_tel = any (v_vistos) then
      v_status := 'repetido';
    elsif app.is_suppressed(v_tel) then
      v_status := 'pediu_para_sair';
    else
      select * into v_achado from app.disparo_numero_na_base(v_tel);
      v_status  := v_achado.situacao;
      v_devolve := v_achado.ficha_id;
      v_ficha   := v_achado.ficha;
      v_contato := v_achado.pessoa_id;

      if v_status is null then
        begin
          insert into public.organizations (kind, name, phone_e164, source_id, collected_at,
                                            collector, owner_id)
          values ('fornecedor'::app.org_kind, coalesce(v_empresa, v_nome), v_tel, v_fonte.id, now(),
                  v_coletor, v_uid)
          returning id into v_org;

          if v_contato is null then
            insert into public.contacts (full_name, phone_e164, source_id)
            values (v_nome, v_tel, v_fonte.id)
            returning id into v_contato;
          else
            -- A pessoa reaproveitada passa a ter o nome digitado: é ele que a
            -- mensagem vai usar ("Carla" digitada não pode virar "Ana"). O
            -- primeiro nome sai do nome completo; o antigo fica na atividade.
            update public.contacts c
               set full_name = v_nome, first_name = null
             where c.id = v_contato;
          end if;
          insert into public.organization_contacts (organization_id, contact_id, is_primary)
          values (v_org, v_contato, true);

          if v_etapa is not null then
            insert into public.deals (organization_id, pipeline_id, stage_id, owner_id,
                                      primary_contact_id, source_id)
            values (v_org, v_pipe, v_etapa, v_uid, v_contato, v_fonte.id)
            returning id into v_deal;
          end if;

          insert into public.activities (type, organization_id, contact_id, deal_id, user_id,
                                         author_kind, body, metadata)
          values ('system', v_org, v_contato, v_deal, v_uid, 'system',
                  'Parceiro criado pelo disparo',
                  jsonb_build_object('origin', 'disparo', 'source_slug', v_fonte.slug)
                  || case when v_achado.pessoa_id is not null
                          then jsonb_build_object('nome_anterior', v_achado.nome_anterior)
                          else '{}'::jsonb end);

          v_status  := 'novo';
          v_devolve := v_org;
        exception when unique_violation then
          -- Outra pessoa do time cadastrou o mesmo número neste instante: vale
          -- a mesma conta, agora com a ficha dela.
          select * into v_achado from app.disparo_numero_na_base(v_tel);
          v_status  := coalesce(v_achado.situacao, 'telefone_de_outra_ficha');
          v_devolve := v_achado.ficha_id;
          v_ficha   := v_achado.ficha;
        end;
      end if;
    end if;

    -- Uma linha sem nome não "gasta" o número: a seguinte, com nome, vale.
    if v_tel is not null and v_status not in ('repetido', 'nome_obrigatorio') then
      v_vistos := v_vistos || v_tel;
    end if;
    if v_status = 'novo' then
      v_novos := v_novos + 1;
    elsif v_status = 'ja_estava' then
      v_ja := v_ja + 1;
    else
      v_recusas := v_recusas + 1;
    end if;

    v_itens := v_itens || jsonb_build_array(jsonb_build_object(
      'linha', v_linha,
      'nome', v_nome,
      'empresa', v_empresa,
      'status', v_status,
      'organization_id', v_devolve,
      -- O nome da ficha que já existe (já estava, ou é de outra pessoa dela),
      -- para a tela dizer qual é.
      'ficha', case when v_status in ('ja_estava', 'numero_de_outra_pessoa') then v_ficha end));
  end loop;

  return jsonb_build_object('ok', true, 'itens', v_itens,
                            'novos', v_novos, 'ja_estavam', v_ja, 'recusados', v_recusas);
end $$;
comment on function public.disparo_adicionar_contatos(jsonb) is
  'Cadastra, pela tela de Disparos, as pessoas digitadas ou coladas (até 500 {nome, telefone, empresa?}). Cada linha volta com o que aconteceu: novo (ficha de fornecedor com a pessoa principal, o negócio na etapa de entrada e a atividade "Parceiro criado pelo disparo"), ja_estava (a mensagem da ficha que já existe vai para este número; devolve a ficha), numero_de_outra_pessoa (o número é de uma pessoa da ficha, mas o WhatsApp da ficha é outro), telefone_de_outra_ficha, repetido, telefone_invalido (inclusive CPF no lugar do telefone), nome_obrigatorio ou pediu_para_sair. Sem a empresa, a ficha leva o nome da pessoa. Não envia nada. Admin, gestor e SDR (12/11/2026).';
revoke all on function public.disparo_adicionar_contatos(jsonb) from public, anon;
grant execute on function public.disparo_adicionar_contatos(jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 3. A lista "Quem recebe", na ordem da tela
-- ---------------------------------------------------------------------
-- O WhatsApp, a pessoa e o bloqueio são os mesmos que o envio usa na hora de
-- mandar (`app.wa_destino_da_ficha`, `app.wa_motivo_de_recusa` e, depois
-- dele, a conversa bloqueada no CRM), e o aviso é a cortesia de 72 h de
-- `app.envio_um`, com a mesma conta: o que a lista mostra é o que vai
-- acontecer.
create or replace function public.disparo_pessoas(p_organizacoes uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_numero  text := app.wa_numero_padrao();
  v_inteiro boolean;
  v_pessoas jsonb;
begin
  if auth.uid() is null or not app.is_manager() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if p_organizacoes is not null and cardinality(p_organizacoes) > 2000 then
    return jsonb_build_object('ok', false, 'motivo', 'lista_invalida');
  end if;
  -- O telefone completo é de admin e gestor (a tabela-base); o SDR vê a máscara.
  v_inteiro := app.admin_ou_gestor();

  with pedidos as (
    -- O mesmo id duas vezes vira uma pessoa só, no primeiro lugar em que apareceu.
    select u.id, min(u.ordem) as ordem
      from unnest(coalesce(p_organizacoes, '{}'::uuid[])) with ordinality as u(id, ordem)
     where u.id is not null
     group by u.id
  ),
  fichas as (
    select pd.ordem, o.id, o.name, d.telefone, d.contact_id, d.primeiro_nome
      from pedidos pd
      join public.organizations o on o.id = pd.id
      cross join lateral app.wa_destino_da_ficha(o.id) d
     where o.deleted_at is null
       and o.anonymized_at is null
       and app.org_is_visible(o.id)
  ),
  com_conversa as (
    select f.*, cv.id as conversa_id, cv.last_inbound_at, cv.bloqueada_em
      from fichas f
      left join public.conversations cv
        on cv.channel = 'whatsapp'::app.channel and cv.business_number = v_numero
       and cv.peer_phone_e164 = f.telefone
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'organization_id', k.id,
           'empresa', k.name,
           'nome', (select c.full_name from public.contacts c where c.id = k.contact_id),
           'primeiro_nome', k.primeiro_nome,
           'telefone', case when v_inteiro then k.telefone else app.mask_phone(k.telefone) end,
           'categoria', (select ca.name from public.organization_categories oc
                           join public.categories ca on ca.id = oc.category_id
                          where oc.organization_id = k.id
                          order by oc.is_primary desc, oc.created_at
                          limit 1),
           -- A ordem é a do envio: sem número, o "nunca mais" da supressão, e
           -- só então a conversa bloqueada no CRM (27/10).
           'bloqueio', case when k.telefone is null then 'sem_whatsapp'
                            else coalesce(app.wa_motivo_de_recusa(k.id, k.contact_id, k.telefone),
                                          case when k.bloqueada_em is not null
                                               then 'conversa_bloqueada' end) end,
           'janela_aberta', k.conversa_id is not null and app.janela_de_24h_aberta(k.conversa_id, now()),
           'aviso', case when k.conversa_id is not null and exists (
                           select 1 from public.messages m
                            where m.conversation_id = k.conversa_id
                              and m.direction = 'out'::app.msg_direction
                              and m.status <> 'failed'::app.msg_status
                              and coalesce(m.sent_at, m.created_at) > now() - interval '72 hours'
                              and (k.last_inbound_at is null
                                   or coalesce(m.sent_at, m.created_at) > k.last_inbound_at))
                         then 'mensagem_recente_sem_resposta' end)
         order by k.ordem), '[]'::jsonb)
    into v_pessoas
    from com_conversa k;

  return jsonb_build_object('ok', true, 'pessoas', v_pessoas);
end $$;
comment on function public.disparo_pessoas(uuid[]) is
  'A lista "Quem recebe" da tela de Disparos, na ordem pedida (até 2.000 fichas; excluídas e invisíveis somem): empresa, pessoa, WhatsApp (inteiro para admin e gestor, mascarado para o SDR), categoria, bloqueio (sem_whatsapp, o motivo de app.wa_motivo_de_recusa ou conversa_bloqueada), se a janela de 24 h está aberta e o aviso de que o disparo vai pular quem recebeu mensagem nossa nas últimas 72 h sem responder. As mesmas contas do envio: o que a lista mostra é o que vai acontecer (12/11/2026).';
revoke all on function public.disparo_pessoas(uuid[]) from public, anon;
grant execute on function public.disparo_pessoas(uuid[]) to authenticated;

-- ---------------------------------------------------------------------
-- 4. A cota de hoje diz também se a janela de envio está aberta
-- ---------------------------------------------------------------------
-- Recriada a partir da definição viva (20261112100000). NOVO: `janela_aberta`
-- e `abre_em` (quando a próxima mensagem pode sair; nulo com a janela aberta),
-- pela mesma `app.janela_do_canal` que o relógio dos disparos consulta.
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
  -- NOVO (12/11/2026, Disparos simplificado)
  v_janela jsonb;
  v_aberta boolean;
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
  -- NOVO: a janela de envio (dia útil, 8h às 17h45) agora.
  v_janela := app.janela_do_canal('whatsapp'::app.channel, now(), false);
  v_aberta := coalesce((v_janela ->> 'aberta')::boolean, false);
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
                   and e.status in ('agendado', 'enviando')),
    -- NOVO: a tela diz "começa a sair amanhã às 8h" e escolhe o cumprimento.
    'janela_aberta', v_aberta,
    'abre_em', case when v_aberta then null else (v_janela ->> 'abre_em')::timestamptz end);
end $$;
comment on function public.envio_em_massa_teto() is
  'A cota de hoje para a tela de Disparos (/envios): o teto que vale (o menor entre o nosso e o da Meta — com a chave teto_da_meta ligada, passado o aquecimento, o nosso é o dela), o tier e a nota do número, quantas conversas a empresa já abriu hoje (como a Meta conta), quanto sobra, quantas mensagens os disparos em curso ainda vão mandar e, desde 12/11/2026, se a janela de envio está aberta agora (janela_aberta) e, fechada, quando abre (abre_em).';
revoke all on function public.envio_em_massa_teto() from public, anon;
grant execute on function public.envio_em_massa_teto() to authenticated;

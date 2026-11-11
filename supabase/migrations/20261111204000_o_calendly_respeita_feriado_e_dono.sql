-- =====================================================================
-- A visita que chega pelo Calendly fica protegida — só na Imova (11/11/2026)
--
-- Gargalo "A visita marcada não está protegida", da revisão da Agenda de
-- 11/11/2026 (Calendly, Google e Meu dia). O que estava aberto, e o que muda:
--
--   1. FERIADO E FIM DE SEMANA. O Calendly só sabe "seg. a sex.": aceitava 20/11
--      (sexta, Consciência Negra) e o CRM não conferia. A visita nunca é em
--      sábado, domingo ou feriado (decisão de 30/09; a `visita_marcar` já recusa
--      `dia_nao_util`). Agora `calendly_receber` recusa o dia que não é útil
--      (`app.eh_dia_util`) pelo MESMO caminho do horário ocupado: nada entra na
--      agenda, o agendamento fica `recusado` (com `motivo_recusa =
--      'dia_nao_util'`), a ficha ganha a nota, quem atende ganha o push que esse
--      caminho já manda (tipo 'compromisso', sem tipo novo), e o CRM pede ao
--      Calendly que cancele, com o recado de que a Imova não atende nesse dia.
--      O texto diz "O Calendly marcou num feriado (20/11); o CRM pediu o
--      cancelamento", e não "horário ocupado".
--
--   2. QUEM ATENDE. A conta do Calendly é do Rafael, então o e-mail do anfitrião
--      é sempre o dele e tudo caía na agenda dele. Agora a pessoa escolhida
--      (`app_settings['calendly'].dono_email`, gravada pelo campo "Quem atende o
--      que chega pelo Calendly" da Agenda, só admin) vale ANTES do anfitrião.
--      Sem escolha, nada muda: o anfitrião, e depois o admin mais antigo.
--      `app.calendly_pessoa_da_agenda()` (a agenda que o espelho copia no Google
--      para o Calendly esconder o horário ocupado) continua sendo a mesma pessoa:
--      as duas leem a escolha por `app.calendly_pessoa_escolhida()`.
--      O rodízio entre corretores fica para depois: ele pede que o espelho conte
--      "todos ocupados", e o espelho é outro trabalho.
--
--   3. A FICHA E O NEGÓCIO NASCEM COM RESPONSÁVEL (`owner_id` = quem atende).
--      Ficha (e negócio) que já existe sem responsável ganha um; a que já tem
--      continua com o dela.
--
--   4. O ENDEREÇO DA VISITA. Vinha só do local do evento; com o evento em Google
--      Meet, a visita ficava com "Local a combinar (o Calendly não informou)". O
--      protótipo tinha a pergunta "Endereço ou código do imóvel". Agora a
--      resposta da pergunta de endereço, imóvel ou código é o `local` da visita;
--      e, se ela traz o código de um anúncio da Imova (IM0003, SA0012, TE…, CO…),
--      vale o endereço do anúncio, com o código citado. A leitura é AQUI, no
--      banco, e não na Edge Function: as respostas já chegam inteiras em
--      `p_evento.respostas`, o anúncio mora no banco, e assim só o banco precisa
--      ser publicado (a `calendly-webhook` não muda).
--
--   5. O CANCELAMENTO QUE FALHOU DE VEZ. Depois de 8 tentativas (ou de uma
--      recusa definitiva do Calendly), o pedido de cancelamento parava e o erro
--      ficava só em `cancelar_erro`. Agora o dono do agendamento e os admins veem
--      o aviso na Agenda (`public.calendly_cancelamentos_que_falharam`) até
--      alguém marcar como resolvido (`public.calendly_cancelamento_resolvido`)
--      ou até o Calendly avisar que cancelou. Sem push novo.
--
-- O QUE NÃO MUDA: a Edge Function, o worker (`apps/workers/src/agenda`), o
-- espelho (`agenda_espelho_*`) e os avisos do celular (`push_fila`,
-- `avisos_*`). Nada vai ao WhatsApp.
--
-- NA KOMUNE NÃO CRIA NADA (o Calendly é só da Imova).
--
-- COMO DESFAZER (no banco da Imova): reaplicar `app.calendly_dono`,
-- `app.calendly_pessoa_da_agenda`, `app.calendly_ficha(text, text, text)`,
-- `public.calendly_receber` e `public.calendly_cancelamentos_pendentes` de
-- 20261110180000; drop function app.calendly_pessoa_escolhida(),
-- app.calendly_ficha(text, text, text, uuid), app.calendly_codigo_do_anuncio(text),
-- app.calendly_local_da_visita(jsonb), public.calendly_quem_atende(),
-- public.calendly_quem_atende_gravar(uuid),
-- public.calendly_cancelamentos_que_falharam(),
-- public.calendly_cancelamento_resolvido(uuid); alter table
-- public.calendly_agendamentos drop column motivo_recusa, drop column anuncio_id,
-- drop column cancelar_resolvido_em, drop column cancelar_resolvido_por.
-- O `dono_email` gravado pela tela fica em app_settings (é o mesmo campo de antes).
-- =====================================================================

do $protegida$
begin
  if (select i.empresa from app.identidade i) = 'komune' then
    raise notice 'O Calendly é só da Imova: no banco da KOMUNE nada foi criado.';
    return;
  end if;
  execute $ddl$

-- ---------------------------------------------------------------------
-- 1. O que o agendamento passa a guardar
-- ---------------------------------------------------------------------
alter table public.calendly_agendamentos
  add column if not exists motivo_recusa text,
  add column if not exists anuncio_id uuid references public.anuncios (id) on delete set null,
  add column if not exists cancelar_resolvido_em timestamptz,
  add column if not exists cancelar_resolvido_por uuid references public.profiles (id) on delete set null;
alter table public.calendly_agendamentos drop constraint if exists calendly_agendamentos_motivo_recusa_chk;
alter table public.calendly_agendamentos add constraint calendly_agendamentos_motivo_recusa_chk
  check (motivo_recusa is null or motivo_recusa in ('ocupado', 'dia_nao_util'));
-- Até aqui, todo recusado era por horário ocupado.
update public.calendly_agendamentos set motivo_recusa = 'ocupado'
 where situacao = 'recusado' and motivo_recusa is null;

comment on column public.calendly_agendamentos.motivo_recusa is
  'Por que o agendamento foi recusado: ''ocupado'' (o horário já tinha compromisso) ou ''dia_nao_util'' (sábado, domingo ou feriado). Nulo no que não foi recusado.';
comment on column public.calendly_agendamentos.anuncio_id is
  'O anúncio cujo código o cliente escreveu na pergunta do imóvel; o endereço dele virou o local da visita.';
comment on column public.calendly_agendamentos.cancelar_resolvido_em is
  'Quando alguém marcou como resolvido o cancelamento que o CRM não conseguiu fazer no Calendly (o aviso da Agenda sai).';

-- ---------------------------------------------------------------------
-- 2. Quem atende: a escolha vale antes do anfitrião
-- ---------------------------------------------------------------------
create or replace function app.calendly_pessoa_escolhida()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id from public.profiles p join auth.users u on u.id = p.id
   where p.is_active
     and lower(u.email::text) = lower(btrim(app.calendly_config() ->> 'dono_email'))
   limit 1
$$;
comment on function app.calendly_pessoa_escolhida() is
  'A pessoa ativa com o e-mail de app_settings[calendly].dono_email ("Quem atende o que chega pelo Calendly"), ou nulo. É a primeira escolha de app.calendly_dono e de app.calendly_pessoa_da_agenda, para as duas apontarem para a mesma pessoa.';

create or replace function app.calendly_pessoa_da_agenda()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    app.calendly_pessoa_escolhida(),
    -- Sem escolha: quem recebeu o último agendamento.
    (select a.dono_id from public.calendly_agendamentos a
       join public.profiles p on p.id = a.dono_id and p.is_active
      order by a.recebido_em desc
      limit 1))
$$;
comment on function app.calendly_pessoa_da_agenda() is
  'De quem é a agenda que o Calendly oferece: a pessoa escolhida em "Quem atende o que chega pelo Calendly" (app_settings[calendly].dono_email); senão quem recebeu o último agendamento. É a agenda que o CRM espelha no Google, e a mesma em que app.calendly_dono põe o agendamento.';

create or replace function app.calendly_dono(p_email text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    -- A pessoa escolhida (11/11/2026: vale antes do anfitrião, que na Imova é
    -- sempre o dono da conta do Calendly).
    app.calendly_pessoa_escolhida(),
    -- A pessoa do CRM com o e-mail do anfitrião no Calendly.
    (select p.id from public.profiles p join auth.users u on u.id = p.id
      where p.is_active and lower(u.email::text) = lower(btrim(p_email))
      limit 1),
    -- O admin mais antigo: um agendamento não fica sem agenda.
    (select p.id from public.profiles p
      where p.is_active and p.role = 'admin'::app.user_role
      order by p.created_at
      limit 1))
$$;
comment on function app.calendly_dono(text) is
  'A agenda em que entra um agendamento do Calendly: a pessoa escolhida em "Quem atende o que chega pelo Calendly" (app_settings[calendly].dono_email); senão a pessoa com o e-mail do anfitrião; senão o admin ativo mais antigo.';

-- ---------------------------------------------------------------------
-- 3. A ficha nasce com responsável
-- ---------------------------------------------------------------------
-- O corpo é o de 20261110180000 com o responsável: a ficha e o negócio novos
-- nascem com `p_dono`; a ficha ligada (e o negócio dela) que não têm
-- responsável ganham `p_dono`; a que já tem continua com o dela.
drop function if exists app.calendly_ficha(text, text, text);
create or replace function app.calendly_ficha(p_nome text, p_email text, p_telefone text, p_dono uuid,
                                              out organizacao uuid, out negocio uuid, out ficha text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tel   text := app.normalize_phone_br(p_telefone);
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_nome  text;
  v_fonte int;  v_cat int;  v_pipe int;  v_etapa int;
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 254 then
    v_email := null;
  end if;

  if v_tel is not null and app.is_suppressed(v_tel) then
    ficha := 'suprimida';
    return;
  end if;

  -- O que a base já conhece é LIGADO, nunca duplicado.
  if v_tel is not null then
    select o.id into organizacao from public.organizations o
     where o.phone_e164 = v_tel and o.deleted_at is null
     limit 1;
    if organizacao is null then
      select oc.organization_id into organizacao
        from public.contacts ct
        join public.organization_contacts oc on oc.contact_id = ct.id
        join public.organizations o on o.id = oc.organization_id and o.deleted_at is null
       where ct.phone_e164 = v_tel and ct.deleted_at is null
       order by oc.is_primary desc
       limit 1;
    end if;
  end if;
  if organizacao is null and v_email is not null then
    select o.id into organizacao from public.organizations o
     where lower(o.email::text) = v_email and o.deleted_at is null
     order by o.created_at
     limit 1;
    if organizacao is null then
      select oc.organization_id into organizacao
        from public.contacts ct
        join public.organization_contacts oc on oc.contact_id = ct.id
        join public.organizations o on o.id = oc.organization_id and o.deleted_at is null
       where lower(ct.email::text) = v_email and ct.deleted_at is null
       order by oc.is_primary desc
       limit 1;
    end if;
  end if;

  if organizacao is not null and app.is_suppressed_target(organizacao, null) then
    organizacao := null;
    ficha := 'suprimida';
    return;
  end if;

  if organizacao is not null then
    ficha := 'ligada';
    -- Só o que faltava: o telefone ou o e-mail que a ficha não tinha, e o
    -- responsável, quando ela não tem nenhum.
    update public.organizations o
       set phone_e164 = case when o.phone_e164 is null and v_tel is not null
                                  and not exists (select 1 from public.organizations y
                                                   where y.phone_e164 = v_tel and y.deleted_at is null)
                             then v_tel else o.phone_e164 end,
           email = coalesce(o.email, v_email),
           owner_id = coalesce(o.owner_id, p_dono)
     where o.id = organizacao
       and ((o.phone_e164 is null and v_tel is not null) or (o.email is null and v_email is not null)
            or (o.owner_id is null and p_dono is not null));
    negocio := app.wa_negocio_da_ficha(organizacao);
    if negocio is not null and p_dono is not null then
      update public.deals d set owner_id = p_dono where d.id = negocio and d.owner_id is null;
    end if;
    return;
  end if;

  -- Quem não está na base vira Cliente, como a ficha automática do WhatsApp.
  select s.id into v_fonte from public.sources s where s.slug = 'calendly';
  select ca.id into v_cat from public.categories ca
   where ca.slug = coalesce(app.ficha_automatica_config() ->> 'categoria', 'comprador') and ca.is_active;
  select p.id into v_pipe from public.pipelines p where p.slug = 'produtor';
  select st.id into v_etapa from public.stages st
   where st.pipeline_id = v_pipe and st.is_entry and st.retired_at is null
   order by st.position limit 1;
  if v_fonte is null or v_cat is null or v_etapa is null then
    ficha := 'catalogo_incompleto';
    return;
  end if;

  v_nome := left(nullif(btrim(regexp_replace(coalesce(app.sem_cpf(p_nome), ''), '\s+', ' ', 'g')), ''), 120);
  begin
    insert into public.organizations (kind, name, phone_e164, email, source_id, collected_at,
                                      collector, owner_id, is_natural_person)
    values ('produtor'::app.org_kind, coalesce(v_nome, 'Agendamento pelo Calendly'), v_tel, v_email,
            v_fonte, now(), 'agendamento pelo Calendly', p_dono, true)
    returning id into organizacao;
    insert into public.organization_categories (organization_id, category_id, is_primary)
    values (organizacao, v_cat, true);
    insert into public.deals (organization_id, pipeline_id, stage_id, owner_id, source_id)
    values (organizacao, v_pipe, v_etapa, p_dono, v_fonte)
    returning id into negocio;
    ficha := 'criada';
  exception when unique_violation then
    -- Outro aviso do mesmo telefone criou a ficha neste instante: liga a ela.
    select o.id into organizacao from public.organizations o
     where o.phone_e164 = v_tel and o.deleted_at is null
     limit 1;
    if organizacao is null then
      -- Sem o detalhe do erro: ele traz o telefone. O Calendly reenvia.
      raise exception 'ficha_nao_criada' using errcode = 'P0001';
    end if;
    negocio := app.wa_negocio_da_ficha(organizacao);
    ficha := 'ligada';
  end;
end $$;
comment on function app.calendly_ficha(text, text, text, uuid) is
  'Acha a ficha de quem agendou pelo Calendly (telefone, depois e-mail, como o lead do portal) ou cria a de Cliente com a origem Calendly. A ficha e o negócio novos nascem com p_dono como responsável; a ligada sem responsável ganha p_dono. Ficha suprimida devolve ficha = suprimida e organizacao nula.';

-- ---------------------------------------------------------------------
-- 4. O endereço da visita: a resposta do cliente, ou o anúncio pelo código
-- ---------------------------------------------------------------------
-- O código de um anúncio da Imova numa frase: a tag (IM, SA, TE, CO, e o PT que
-- veio da Arbo) e o número, com ou sem zeros, hífen ou o sufixo do sistema
-- antigo ("IM0003", "im 3", "SA0012_IMOVA"). Devolve o anúncio vivo com essa tag
-- e esse número (o no ar primeiro), ou nada.
create or replace function app.calendly_codigo_do_anuncio(p_texto text,
                                                          out anuncio_id uuid, out codigo text,
                                                          out endereco text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_achado text[];
begin
  v_achado := regexp_match(coalesce(p_texto, ''),
                '(?:^|[^[:alnum:]])(IM|SA|TE|CO|PT)[ -]?([0-9]{1,9})(?:_[[:alpha:]]+)?(?:$|[^[:alnum:]])', 'i');
  if v_achado is null then
    return;
  end if;
  select a.id, a.codigo,
         nullif(concat_ws(', ',
           case when nullif(btrim(coalesce(a.endereco, '')), '') is null then null
                -- "Av Barra de Tabatinga, 2004" com o número 2004: não repete.
                when nullif(btrim(coalesce(a.numero, '')), '') is null
                  or position(btrim(a.numero) in a.endereco) > 0 then btrim(a.endereco)
                else btrim(a.endereco) || ', ' || btrim(a.numero) end,
           nullif(btrim(coalesce(a.complemento, '')), ''),
           nullif(btrim(coalesce(a.bairro, '')), ''),
           nullif(btrim(coalesce(a.cidade, '')), '')), '')
    into anuncio_id, codigo, endereco
    from public.anuncios a
   where a.excluido_em is null
     and upper(left(a.codigo, 2)) = upper(v_achado[1])
     and ltrim(substring(a.codigo from '^[A-Za-z]{2}([0-9]+)(?:_[A-Za-z]+)?$'), '0')
         = ltrim(v_achado[2], '0')
   order by (a.situacao = 'no_ar') desc, a.updated_at desc
   limit 1;
end $$;
comment on function app.calendly_codigo_do_anuncio(text) is
  'O anúncio da Imova cujo código (IM0003, SA0012, TE…, CO…, com ou sem zeros e sufixo) aparece no texto, com o endereço montado (rua e número, complemento, bairro, cidade). Nada quando não há código ou anúncio.';

-- A resposta à pergunta de endereço, imóvel ou código ("Endereço ou código do
-- imóvel", do protótipo). Com o código de um anúncio: o endereço dele, com o
-- código citado. Sem código: o que o cliente escreveu, se for um endereço (e
-- não só "sim", ou um código que não é de anúncio nenhum).
create or replace function app.calendly_local_da_visita(p_respostas jsonb,
                                                        out lugar text, out anuncio_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_resp text;
  v_anuncio record;
  v_resto text;
begin
  select btrim(r.value ->> 'resposta') into v_resp
    from jsonb_array_elements(case when jsonb_typeof(p_respostas) = 'array' then p_respostas
                                   else '[]'::jsonb end) with ordinality r(value, n)
   where coalesce(r.value ->> 'pergunta', '') ~* 'endere[cç]o|im[oó]vel|c[oó]digo'
     and nullif(btrim(coalesce(r.value ->> 'resposta', '')), '') is not null
   order by r.n
   limit 1;
  if v_resp is null then
    return;
  end if;

  select * into v_anuncio from app.calendly_codigo_do_anuncio(v_resp);
  if v_anuncio.anuncio_id is not null then
    anuncio_id := v_anuncio.anuncio_id;
    if v_anuncio.endereco is not null then
      lugar := left(v_anuncio.endereco || ' (anúncio ' || v_anuncio.codigo || ')', 500);
    else
      -- O anúncio não tem endereço: o cartão fica sem linha de onde, como no
      -- "Local a combinar"; o código continua na nota e em `anuncio_id`.
      lugar := left('Local a combinar (o anúncio ' || v_anuncio.codigo || ' não tem endereço)', 500);
    end if;
    return;
  end if;

  -- Sem anúncio: vale o texto, se sobrar um endereço depois de tirar o código,
  -- as palavras da pergunta e o "sim/não".
  v_resto := regexp_replace(
               regexp_replace(v_resp, '(IM|SA|TE|CO|PT)[ -]?[0-9]+(_[[:alpha:]]+)?', ' ', 'gi'),
               '\m(c[oó]d(igo)?|im[oó]vel|an[uú]ncio|ref(er[eê]ncia)?|sim|n[aã]o|do|da|de|o|a)\M', ' ', 'gi');
  if v_resto ~ '[[:alpha:]]{3,}' then
    lugar := left(v_resp, 500);
  end if;
end $$;
comment on function app.calendly_local_da_visita(jsonb) is
  'O local da visita lido das respostas do Calendly (a pergunta com "endereço", "imóvel" ou "código"): o endereço do anúncio cujo código o cliente escreveu, com o código citado, ou o endereço que ele escreveu. Nada quando a pergunta não existe ou a resposta não é endereço.';

-- ---------------------------------------------------------------------
-- 5. A porta do webhook, com o dia útil, o responsável e o endereço
-- ---------------------------------------------------------------------
-- O corpo é o de 20261110180000. O que mudou está marcado com "11/11/2026".
create or replace function public.calendly_receber(p_evento jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tipo     text := p_evento ->> 'evento';
  v_uri      text := left(nullif(btrim(coalesce(p_evento ->> 'convidado_uri', '')), ''), 300);
  v_ev_uri   text := left(nullif(btrim(coalesce(p_evento ->> 'evento_uri', '')), ''), 300);
  v_ant_uri  text := left(nullif(btrim(coalesce(p_evento ->> 'convidado_anterior_uri', '')), ''), 300);
  v_ag       public.calendly_agendamentos%rowtype;
  v_ant      public.calendly_agendamentos%rowtype;
  v_inicio   timestamptz;
  v_fim      timestamptz;
  v_natureza text;
  v_formato  text;
  v_local    text;
  v_link     text;
  v_tipo_ev  text;
  v_resp     jsonb;
  v_resp_txt text;
  v_dono     uuid;
  v_org      uuid;
  v_deal     uuid;
  v_ficha    text;
  v_nome     text;
  v_titulo   text;
  v_conf     jsonb;
  v_situacao text;
  v_reuniao  uuid;
  v_task     uuid;
  v_aviso    uuid;
  v_id       uuid;
  v_detalhe  text;
  v_canc_por text;
  v_motivo   text;
  v_reu_ant  uuid;
  v_pela_casa boolean;
  -- 11/11/2026
  v_dia      date;
  v_recusa   text;
  v_feriado  text;
  v_marcou   text;
  v_anuncio  uuid;
  v_da_visita record;
begin
  if v_tipo is null or v_tipo not in ('invitee.created', 'invitee.canceled') then
    return jsonb_build_object('ok', true, 'ignorado', true, 'motivo', 'evento_nao_tratado');
  end if;
  if v_uri is null or v_ev_uri is null or char_length(v_uri) < 10 or char_length(v_ev_uri) < 10 then
    return jsonb_build_object('ok', false, 'motivo', 'sem_uri');
  end if;

  -- Avisos do mesmo convidado, um de cada vez: o Calendly pode entregar o mesmo
  -- aviso duas vezes ao mesmo tempo.
  perform pg_advisory_xact_lock(hashtextextended('calendly:' || v_uri, 0));
  select * into v_ag from public.calendly_agendamentos where convidado_uri = v_uri;

  -- O que vem nos dois tipos de aviso.
  begin
    v_inicio := (p_evento ->> 'inicio')::timestamptz;
    v_fim    := (p_evento ->> 'fim')::timestamptz;
  exception when others then
    return jsonb_build_object('ok', false, 'motivo', 'horario_invalido');
  end;
  v_natureza := case when p_evento ->> 'natureza' = 'visita' then 'visita' else 'reuniao' end;
  v_tipo_ev  := left(nullif(btrim(coalesce(p_evento ->> 'tipo_de_evento', '')), ''), 200);

  -- =================================================================
  -- CANCELADO (ou a primeira metade de uma remarcação)
  -- =================================================================
  if v_tipo = 'invitee.canceled' then
    v_situacao := case when coalesce((p_evento ->> 'remarcado')::boolean, false)
                       then 'remarcado' else 'cancelado' end;
    v_canc_por := case p_evento -> 'cancelamento' ->> 'por'
                    when 'convidado' then 'convidado' when 'anfitriao' then 'anfitriao' end;
    v_motivo   := left(nullif(btrim(coalesce(app.sem_cpf(p_evento -> 'cancelamento' ->> 'motivo'), '')), ''), 500);

    if v_ag.id is null then
      -- O cancelamento chegou antes do agendamento, ou o agendamento é de antes
      -- da integração: fica anotado, e o agendamento que chegar depois é ignorado.
      insert into public.calendly_agendamentos
        (convidado_uri, evento_uri, situacao, natureza, tipo_de_evento, inicio, fim,
         cancelado_em, cancelado_por, motivo_cancelamento, cancelado_no_calendly_em)
      values (v_uri, v_ev_uri, v_situacao, v_natureza, v_tipo_ev, v_inicio, v_fim,
              now(), v_canc_por, v_motivo, now())
      returning id into v_id;
      return jsonb_build_object('ok', true, 'duplicado', false, 'agendamento_id', v_id,
                                'situacao', v_situacao, 'sem_agendamento', true);
    end if;

    -- Já fechado, ou recusado (é o CRM confirmando o cancelamento que pediu).
    if v_ag.situacao in ('cancelado', 'remarcado', 'recusado') then
      update public.calendly_agendamentos
         set cancelado_no_calendly_em = coalesce(cancelado_no_calendly_em, now()),
             cancelado_em = coalesce(cancelado_em, now()), atualizado_em = now()
       where id = v_ag.id and cancelado_no_calendly_em is null;
      return jsonb_build_object('ok', true, 'duplicado', true, 'agendamento_id', v_ag.id,
                                'situacao', v_ag.situacao);
    end if;

    -- A equipe já tinha tirado da agenda pelo CRM, e o CRM pediu ao Calendly que
    -- cancelasse: o aviso que volta é a confirmação, sem nota nem push.
    v_pela_casa := v_ag.situacao = 'agendado' and app.calendly_lado_crm_fechado(v_ag);

    if v_ag.situacao = 'agendado' and not v_pela_casa then
      perform app.calendly_fechar(v_ag.id, v_situacao, v_motivo);
    else
      -- suprimido / sem_dono / desmarcado pelo CRM: nada a tirar da agenda.
      update public.calendly_agendamentos
         set situacao = case when situacao = 'agendado' then 'cancelado' else v_situacao end,
             cancelado_em = coalesce(cancelado_em, now()),
             cancelado_no_calendly_em = coalesce(cancelado_no_calendly_em, now()), atualizado_em = now()
       where id = v_ag.id;
    end if;
    update public.calendly_agendamentos
       set cancelado_por = coalesce(v_canc_por, cancelado_por),
           motivo_cancelamento = coalesce(v_motivo, motivo_cancelamento), atualizado_em = now()
     where id = v_ag.id;

    -- O cancelamento do cliente (não a remarcação, que se anuncia pelo novo, nem a
    -- confirmação do que o CRM pediu) é contado na ficha e a quem atende.
    if v_situacao = 'cancelado' and v_ag.situacao = 'agendado' and not v_pela_casa then
      v_titulo := coalesce((select t.title from public.tasks t where t.id = v_ag.task_id),
                           case when v_ag.natureza = 'visita' then 'Visita' else 'Reunião' end);
      if v_ag.organization_id is not null then
        insert into public.activities (type, organization_id, deal_id, user_id, author_kind, body, metadata)
        values ('system', v_ag.organization_id, v_ag.deal_id, null, 'system',
                left(format('%s cancelada pelo %s no Calendly (era %s).%s',
                            case when v_ag.natureza = 'visita' then 'Visita' else 'Reunião' end,
                            case when v_canc_por = 'anfitriao' then 'anfitrião' else 'cliente' end,
                            app.avisos_quando(v_ag.inicio, true),
                            case when v_motivo is not null then ' Motivo: ' || v_motivo else '' end), 2000),
                jsonb_build_object('origin', 'calendly', 'calendly_agendamento_id', v_ag.id,
                                   'situacao', 'cancelado'));
      end if;
      if v_ag.dono_id is not null then
        begin
          insert into app.push_fila (pessoa_id, tipo, chave, corpo, caminho)
          values (v_ag.dono_id, 'compromisso', 'calendly:cancelado:' || v_ag.id,
                  left('Cancelado pelo Calendly: ' || v_titulo || ', '
                       || app.avisos_quando(v_ag.inicio, true), 240),
                  '/agenda?dia=' || to_char(v_ag.inicio at time zone 'America/Fortaleza', 'YYYY-MM-DD'))
          on conflict (chave) do nothing;
        exception when others then
          raise warning 'calendly: push do cancelamento: %', sqlerrm;
        end;
      end if;
    end if;

    return jsonb_build_object('ok', true, 'duplicado', false, 'agendamento_id', v_ag.id,
                              'situacao', case when v_pela_casa then 'cancelado' else v_situacao end);
  end if;

  -- =================================================================
  -- AGENDADO
  -- =================================================================
  if v_ag.id is not null then
    return jsonb_build_object('ok', true, 'duplicado', true, 'agendamento_id', v_ag.id,
                              'situacao', v_ag.situacao);
  end if;
  if v_inicio is null or v_fim is null or v_fim <= v_inicio then
    return jsonb_build_object('ok', false, 'motivo', 'horario_invalido');
  end if;

  -- As respostas, sem CPF e com teto.
  select coalesce(jsonb_agg(jsonb_build_object(
           'pergunta', left(app.sem_cpf(e.value ->> 'pergunta'), 300),
           'resposta', left(app.sem_cpf(e.value ->> 'resposta'), 500))), '[]'::jsonb)
    into v_resp
    from (select value from jsonb_array_elements(
            case when jsonb_typeof(p_evento -> 'respostas') = 'array' then p_evento -> 'respostas'
                 else '[]'::jsonb end) limit 20) e
   where nullif(btrim(coalesce(e.value ->> 'resposta', '')), '') is not null;
  select string_agg((r.value ->> 'pergunta') || ': ' || (r.value ->> 'resposta'), ' · ')
    into v_resp_txt from jsonb_array_elements(v_resp) r;

  -- Onde. Visita é sempre presencial; reunião presencial sem endereço fica com
  -- o lugar a combinar (a trava `reunioes_lugar_chk` pede um texto).
  v_local := left(nullif(btrim(coalesce(app.sem_cpf(p_evento ->> 'local'), '')), ''), 500);
  v_link  := case when (p_evento ->> 'link') ~ '^https://' then left(p_evento ->> 'link', 1000) end;
  v_formato := case when v_natureza = 'visita' then 'presencial'
                    when p_evento ->> 'formato' = 'presencial' then 'presencial'
                    else 'online' end;
  -- 11/11/2026: na visita, o endereço que o cliente deu (ou o do anúncio cujo
  -- código ele deu) vale por cima do local do evento, que é o da sala on-line
  -- ou do escritório.
  if v_natureza = 'visita' then
    select * into v_da_visita from app.calendly_local_da_visita(v_resp);
    v_local   := coalesce(v_da_visita.lugar, v_local);
    v_anuncio := v_da_visita.anuncio_id;
  end if;
  if v_formato = 'presencial' then
    v_link := null;
    v_local := coalesce(v_local, 'Local a combinar (o Calendly não informou)');
  else
    v_local := null;
  end if;

  -- A remarcação: o agendamento velho fecha antes de o novo ocupar o horário
  -- (senão o novo bateria com o velho na conta do conflito).
  if v_ant_uri is not null then
    select * into v_ant from public.calendly_agendamentos where convidado_uri = v_ant_uri;
    if v_ant.id is not null then
      perform app.calendly_fechar(v_ant.id, 'remarcado', null);
      v_reu_ant := v_ant.reuniao_id;
    end if;
  end if;

  v_dono := app.calendly_dono(p_evento ->> 'anfitriao_email');
  -- 11/11/2026: a ficha e o negócio nascem com quem atende como responsável.
  select f.organizacao, f.negocio, f.ficha into v_org, v_deal, v_ficha
    from app.calendly_ficha(p_evento ->> 'nome', p_evento ->> 'email', p_evento ->> 'telefone', v_dono) f;

  if v_dono is null or v_org is null then
    v_situacao := case when v_dono is null then 'sem_dono' else 'suprimido' end;
    insert into public.calendly_agendamentos
      (convidado_uri, evento_uri, situacao, natureza, tipo_de_evento, inicio, fim, formato, link, local,
       dono_id, respostas, ficha, remarcado_de, link_cancelar, link_remarcar, anuncio_id)
    values (v_uri, v_ev_uri, v_situacao, v_natureza, v_tipo_ev, v_inicio, v_fim, v_formato, v_link, v_local,
            v_dono, v_resp, v_ficha, v_ant.id,
            left(p_evento ->> 'link_cancelar', 500), left(p_evento ->> 'link_remarcar', 500), v_anuncio)
    returning id into v_id;
    return jsonb_build_object('ok', true, 'duplicado', false, 'agendamento_id', v_id,
                              'situacao', v_situacao, 'ficha', v_ficha);
  end if;

  select o.name into v_nome from public.organizations o where o.id = v_org;
  v_titulo := case when v_natureza = 'visita' then 'Visita: ' || coalesce(v_nome, 'cliente')
                   else 'Reunião com ' || coalesce(v_nome, 'cliente') end;

  -- Serializa por (pessoa, dia), como a `reuniao_gravar`: dois agendamentos no
  -- mesmo instante enxergam um ao outro na conta do conflito.
  v_dia := (v_inicio at time zone 'America/Fortaleza')::date;
  perform pg_advisory_xact_lock(hashtextextended(v_dono::text || v_dia::text, 0));

  -- 11/11/2026: sábado, domingo e feriado não têm visita nem reunião, como na
  -- `visita_marcar`. O Calendly só sabe "seg. a sex.", então o feriado chega.
  if not app.eh_dia_util(v_dia) then
    v_recusa   := 'dia_nao_util';
    v_situacao := 'recusado';
    v_conf     := '[]'::jsonb;
    select h.name into v_feriado from public.holidays h where h.date = v_dia order by h.id limit 1;
    v_marcou := case when v_feriado is not null then 'num feriado'
                     when extract(isodow from v_dia) = 6 then 'num sábado'
                     else 'num domingo' end
                || ' (' || to_char(v_dia, 'DD/MM') || ')';
  else
    v_conf := app.calendly_conflitos(v_dono, v_inicio, v_fim);
    v_situacao := case when jsonb_array_length(v_conf) > 0 then 'recusado' else 'agendado' end;
    if v_situacao = 'recusado' then
      v_recusa := 'ocupado';
    end if;
  end if;

  if v_natureza = 'reuniao' and v_situacao = 'agendado' then
    begin
      insert into public.reunioes (organization_id, deal_id, contact_id, dono_id, titulo, formato,
                                   inicio, fim, link, local, estado, marcada_por, observacao, remarcada_de)
      values (v_org, v_deal, null, v_dono, v_titulo, v_formato, v_inicio, v_fim, v_link, v_local,
              'marcada', 'calendly',
              left('Agendada pelo cliente no Calendly' || coalesce(' (' || v_tipo_ev || ')', '') || '.'
                   || coalesce(' ' || v_resp_txt, ''), 2000),
              v_reu_ant)
      returning id into v_reuniao;
    exception when exclusion_violation then
      -- Outra reunião entrou no horário entre a conta e o insert.
      v_conf := app.calendly_conflitos(v_dono, v_inicio, v_fim);
      v_situacao := 'recusado';
      v_recusa := 'ocupado';
    end;
  end if;

  -- -----------------------------------------------------------------
  -- Recusado: horário ocupado, ou (11/11/2026) dia que não é útil. Nada entra
  -- na agenda; o Calendly cancela e pede ao cliente outro horário (caminho 3).
  -- -----------------------------------------------------------------
  if v_situacao = 'recusado' then
    insert into public.calendly_agendamentos
      (convidado_uri, evento_uri, situacao, natureza, tipo_de_evento, inicio, fim, formato, link, local,
       dono_id, organization_id, deal_id, conflitos, respostas, ficha, remarcado_de,
       link_cancelar, link_remarcar, motivo_recusa, anuncio_id)
    values (v_uri, v_ev_uri, 'recusado', v_natureza, v_tipo_ev, v_inicio, v_fim, v_formato, v_link, v_local,
            v_dono, v_org, v_deal, v_conf, v_resp, v_ficha, v_ant.id,
            left(p_evento ->> 'link_cancelar', 500), left(p_evento ->> 'link_remarcar', 500),
            v_recusa, v_anuncio)
    returning id into v_id;

    insert into public.activities (type, organization_id, deal_id, user_id, author_kind, body, metadata)
    values ('system', v_org, v_deal, null, 'system',
            left(case when v_recusa = 'dia_nao_util' then
                   format('Tentou agendar %s pelo Calendly para %s%s. O Calendly marcou %s; o CRM pediu o cancelamento, e o Calendly pede ao cliente outro dia.%s',
                          case when v_natureza = 'visita' then 'uma visita' else 'uma reunião' end,
                          app.avisos_quando(v_inicio, true),
                          coalesce(' (' || v_feriado || ')', ''),
                          v_marcou,
                          coalesce(' Respostas: ' || v_resp_txt, ''))
                 else
                   format('Tentou agendar %s pelo Calendly para %s, mas o horário já estava ocupado (%s às %s). O Calendly cancela e pede ao cliente outro horário.%s',
                          case when v_natureza = 'visita' then 'uma visita' else 'uma reunião' end,
                          app.avisos_quando(v_inicio, true),
                          coalesce(v_conf -> 0 ->> 'titulo', 'outro compromisso'),
                          to_char((v_conf -> 0 ->> 'inicio')::timestamptz at time zone 'America/Fortaleza', 'HH24"h"MI'),
                          coalesce(' Respostas: ' || v_resp_txt, ''))
                 end, 2000),
            jsonb_build_object('origin', 'calendly', 'calendly_agendamento_id', v_id,
                               'situacao', 'recusado', 'recusa', v_recusa,
                               'ficha', v_ficha, 'natureza', v_natureza));
    begin
      insert into app.push_fila (pessoa_id, tipo, chave, corpo, caminho)
      values (v_dono, 'compromisso', 'calendly:recusado:' || v_id,
              left(case when v_recusa = 'dia_nao_util' then
                     'Pelo Calendly: ' || coalesce(v_nome, 'um cliente') || ' tentou marcar '
                     || app.avisos_quando(v_inicio, true) || '. O Calendly marcou ' || v_marcou
                     || '; o CRM pediu o cancelamento.'
                   else
                     'Pelo Calendly: ' || coalesce(v_nome, 'um cliente') || ' tentou marcar '
                     || app.avisos_quando(v_inicio, true)
                     || ', mas o horário já estava ocupado. O Calendly vai pedir outro horário.'
                   end, 240),
              '/parceiros/' || v_org::text)
      on conflict (chave) do nothing;
    exception when others then
      raise warning 'calendly: push do recusado: %', sqlerrm;
    end;

    return jsonb_build_object('ok', true, 'duplicado', false, 'agendamento_id', v_id,
                              'situacao', 'recusado', 'recusa', v_recusa, 'natureza', v_natureza,
                              'ficha', v_ficha, 'conflitos', jsonb_array_length(v_conf));
  end if;

  -- -----------------------------------------------------------------
  -- Horário livre: entra na agenda.
  -- -----------------------------------------------------------------
  insert into public.tasks (title, kind, status, priority, due_at, assignee_id,
                            organization_id, deal_id, origin)
  values (v_titulo,
          case when v_natureza = 'visita' then 'visit'::app.task_kind else 'meeting'::app.task_kind end,
          'todo'::app.task_status, 2, v_inicio, v_dono, v_org, v_deal, 'calendly')
  returning id into v_task;

  if v_reuniao is not null then
    update public.reunioes set task_id = v_task, atualizada_em = now() where id = v_reuniao;
    perform app.esteira_enfileirar('reuniao_avisos',
              jsonb_build_object('reuniao_id', v_reuniao,
                                 'motivo', case when v_reu_ant is not null then 'remarcada' else 'marcada' end,
                                 'chave', 'reuniao:' || v_reuniao::text || ':marcada'),
              'reuniao:' || v_reuniao::text || ':marcada');
  end if;

  if v_deal is not null then
    perform app.calendly_andar_etapa(v_deal, v_inicio);
  end if;

  -- A frase a mais do aviso: de quando veio a remarcação.
  v_detalhe := case when v_ant.id is not null and v_ant.inicio is not null
                    then left('O cliente remarcou (era ' || app.avisos_quando(v_ant.inicio, true) || ').', 300) end;

  insert into public.agenda_avisos (dono_id, marcado_por, origem, tipo, task_id, reuniao_id,
                                    titulo, quando, detalhe)
  values (v_dono, null, 'calendly', v_natureza, v_task, v_reuniao, v_titulo, v_inicio, v_detalhe)
  returning id into v_aviso;

  -- O push do celular, com a chave que a varredura usaria (ela não pega aviso
  -- sem `marcado_por`). Falhar aqui não derruba o agendamento.
  begin
    insert into app.push_fila (pessoa_id, tipo, chave, corpo, caminho)
    values (v_dono, 'compromisso', 'compromisso:' || v_aviso,
            left('Pelo Calendly: ' || v_titulo || ', ' || app.avisos_quando(v_inicio, true), 240),
            '/agenda?dia=' || to_char(v_inicio at time zone 'America/Fortaleza', 'YYYY-MM-DD'))
    on conflict (chave) do nothing;
  exception when others then
    raise warning 'calendly: push do agendamento: %', sqlerrm;
  end;

  insert into public.calendly_agendamentos
    (convidado_uri, evento_uri, situacao, natureza, tipo_de_evento, inicio, fim, formato, link, local,
     dono_id, organization_id, deal_id, reuniao_id, task_id, aviso_id, conflitos, respostas, ficha,
     remarcado_de, link_cancelar, link_remarcar, anuncio_id)
  values (v_uri, v_ev_uri, 'agendado', v_natureza, v_tipo_ev, v_inicio, v_fim, v_formato, v_link, v_local,
          v_dono, v_org, v_deal, v_reuniao, v_task, v_aviso, '[]'::jsonb, v_resp, v_ficha,
          v_ant.id, left(p_evento ->> 'link_cancelar', 500), left(p_evento ->> 'link_remarcar', 500),
          v_anuncio)
  returning id into v_id;

  insert into public.activities (type, organization_id, deal_id, user_id, author_kind, body, metadata)
  values ('system', v_org, v_deal, null, 'system',
          left(format('%s pelo cliente no Calendly para %s%s.%s',
                      case when v_natureza = 'visita' then 'Visita agendada' else 'Reunião agendada' end,
                      app.avisos_quando(v_inicio, true),
                      coalesce(' (' || v_tipo_ev || ')', ''),
                      coalesce(' Respostas: ' || v_resp_txt, '')), 2000),
          jsonb_build_object('origin', 'calendly', 'calendly_agendamento_id', v_id,
                             'situacao', 'agendado', 'ficha', v_ficha, 'natureza', v_natureza));

  return jsonb_build_object('ok', true, 'duplicado', false, 'agendamento_id', v_id,
                            'situacao', 'agendado', 'natureza', v_natureza, 'ficha', v_ficha,
                            'reuniao_id', v_reuniao, 'task_id', v_task, 'aviso_id', v_aviso,
                            'conflitos', 0);
end $$;
comment on function public.calendly_receber(jsonb) is
  'Recebe um aviso do Calendly (só a Edge Function calendly-webhook, com a chave de serviço), já resumido por ela. Idempotente pela URI do convidado. Agendado em horário livre de dia útil: liga ou cria a ficha (com quem atende como responsável), põe a reunião ou visita na agenda de quem atende (o endereço da visita pode vir da resposta do cliente ou do anúncio pelo código), avisa (agenda_avisos e push) e anota na ficha. Em horário ocupado, sábado, domingo ou feriado: não entra na agenda (recusado, com motivo_recusa) e o cancelamento fica pendente para o Calendly. Cancelado: tira da agenda e avisa. Não envia nada pelo WhatsApp.';

-- ---------------------------------------------------------------------
-- 6. O recado ao cliente quando o dia não é útil
-- ---------------------------------------------------------------------
-- O corpo é o de 20261110180000 com o recado do dia que não é útil.
create or replace function public.calendly_cancelamentos_pendentes(p_limite int default 10)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'evento_uri', x.evento_uri, 'motivo', x.motivo)
                            order by x.recebido_em), '[]'::jsonb)
    from (
      select a.id, a.evento_uri, a.recebido_em,
             case
               when a.situacao = 'recusado' and a.motivo_recusa = 'dia_nao_util'
                    and exists (select 1 from public.holidays h
                                 where h.date = (a.inicio at time zone 'America/Fortaleza')::date) then
                 'Este dia é feriado e a Imova Imobiliária não atende. Por favor, escolha outro dia pelo mesmo link.'
               when a.situacao = 'recusado' and a.motivo_recusa = 'dia_nao_util' then
                 'A Imova Imobiliária não atende aos sábados e domingos. Por favor, escolha outro dia pelo mesmo link.'
               when a.situacao = 'recusado' then
                 'Este horário acabou de ser ocupado na agenda da Imova Imobiliária. Por favor, escolha outro horário pelo mesmo link.'
               when exists (select 1 from public.reunioes r where r.id = a.reuniao_id and r.estado = 'remarcada') then
                 'A Imova Imobiliária remarcou este compromisso e vai combinar o novo horário com você.'
               else
                 'A Imova Imobiliária precisou cancelar este compromisso e vai falar com você.'
             end as motivo
        from public.calendly_agendamentos a
       where a.cancelado_no_calendly_em is null
         and a.cancelar_tentativas < 8
         and (a.cancelar_depois_de is null or a.cancelar_depois_de <= now())
         -- O Calendly não cancela o que já passou.
         and (a.inicio is null or a.inicio > now())
         and (a.situacao = 'recusado'
              or (a.situacao = 'agendado' and app.calendly_lado_crm_fechado(a)))
       order by a.recebido_em
       limit greatest(1, least(coalesce(p_limite, 10), 50))
    ) x
$$;
comment on function public.calendly_cancelamentos_pendentes(int) is
  'O que o CRM ainda precisa cancelar no Calendly: o agendamento recusado (horário ocupado, sábado, domingo ou feriado) e o que a equipe desmarcou ou remarcou pelo CRM. Lido pelo imova-worker-wa, que chama a API do Calendly e responde com calendly_cancelamento_feito ou _falhou.';

-- ---------------------------------------------------------------------
-- 7. O cancelamento que o CRM não conseguiu fazer: aviso na Agenda
-- ---------------------------------------------------------------------
-- O que esgotou as tentativas (ou que o Calendly recusou de vez) e continua sem
-- cancelamento confirmado. Vê quem é dono do agendamento e quem é admin. Sai
-- quando alguém marca como resolvido, ou quando o Calendly avisa que cancelou
-- (a pessoa cancelou lá: o aviso `invitee.canceled` preenche
-- `cancelado_no_calendly_em`).
create or replace function public.calendly_cancelamentos_que_falharam()
returns table (id uuid, cliente text, natureza text, inicio timestamptz, situacao text,
               motivo_recusa text, erro text, dono_id uuid, dono_nome text, organization_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, o.name, a.natureza, a.inicio, a.situacao, a.motivo_recusa, a.cancelar_erro,
         a.dono_id, p.full_name, a.organization_id
    from public.calendly_agendamentos a
    left join public.organizations o on o.id = a.organization_id
    left join public.profiles p on p.id = a.dono_id
   where a.cancelado_no_calendly_em is null
     and a.cancelar_resolvido_em is null
     and a.cancelar_tentativas >= 8
     and (a.situacao = 'recusado'
          or (a.situacao = 'agendado' and app.calendly_lado_crm_fechado(a)))
     and (a.dono_id = (select auth.uid()) or (select app.is_admin()))
   order by a.inicio nulls last, a.recebido_em
$$;
comment on function public.calendly_cancelamentos_que_falharam() is
  'Os agendamentos que o CRM devia cancelar no Calendly e não conseguiu (8 tentativas, ou recusa definitiva do Calendly), para o aviso da Agenda: só os do próprio dono, ou todos para admin. Some com public.calendly_cancelamento_resolvido ou quando o Calendly confirma o cancelamento.';

create or replace function public.calendly_cancelamento_resolvido(p_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_dono uuid;
begin
  select a.dono_id into v_dono from public.calendly_agendamentos a where a.id = p_id;
  if not found then
    return false;
  end if;
  if (select auth.uid()) is null
     or not (v_dono = (select auth.uid()) or (select app.is_admin())) then
    raise exception 'so_o_dono_ou_admin' using errcode = '42501';
  end if;
  update public.calendly_agendamentos
     set cancelar_resolvido_em = now(), cancelar_resolvido_por = (select auth.uid()),
         atualizado_em = now()
   where id = p_id and cancelar_resolvido_em is null;
  return found;
end $$;
comment on function public.calendly_cancelamento_resolvido(uuid) is
  'Marca como resolvido (alguém cancelou no Calendly e avisou o cliente) o cancelamento que o CRM não conseguiu fazer: o aviso da Agenda sai. Só o dono do agendamento ou um admin.';

-- ---------------------------------------------------------------------
-- 8. "Quem atende o que chega pelo Calendly": o campo da Agenda (só admin)
-- ---------------------------------------------------------------------
create or replace function public.calendly_quem_atende()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_email text := nullif(btrim(coalesce(app.calendly_config() ->> 'dono_email', '')), '');
begin
  if not (select app.is_admin()) then
    raise exception 'so_admin' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'pessoa_id', app.calendly_pessoa_escolhida(),
    -- O e-mail gravado que não é de ninguém ativo (a pessoa saiu, ou foi
    -- digitado à mão): a tela avisa que, assim, vale o anfitrião.
    'email_sem_pessoa', case when v_email is not null and app.calendly_pessoa_escolhida() is null
                             then v_email end,
    -- Sem escolha, o agendamento vai para o anfitrião; o último que chegou diz quem é.
    'ultimo_dono_nome', (select p.full_name from public.calendly_agendamentos a
                           join public.profiles p on p.id = a.dono_id
                          order by a.recebido_em desc limit 1),
    'pessoas', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'nome', p.full_name,
                                                             'papel', p.role)
                                          order by p.full_name)
                           from public.profiles p
                          where p.is_active
                            and p.role in ('admin'::app.user_role, 'gestor'::app.user_role,
                                           'sdr'::app.user_role)), '[]'::jsonb));
end $$;
comment on function public.calendly_quem_atende() is
  'Para o campo "Quem atende o que chega pelo Calendly" (só admin): a pessoa escolhida, o e-mail gravado que não é de ninguém ativo, quem recebeu o último agendamento e as pessoas ativas que atendem (admin, gestor e SDR).';

create or replace function public.calendly_quem_atende_gravar(p_pessoa uuid default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_email text;
begin
  if not (select app.is_admin()) then
    raise exception 'so_admin' using errcode = '42501';
  end if;
  if p_pessoa is not null then
    select lower(u.email::text) into v_email
      from public.profiles p join auth.users u on u.id = p.id
     where p.id = p_pessoa and p.is_active
       and p.role in ('admin'::app.user_role, 'gestor'::app.user_role, 'sdr'::app.user_role);
    if v_email is null then
      raise exception 'pessoa_nao_atende' using errcode = '22023',
        hint = 'Escolha uma pessoa ativa da equipe (admin, gestor ou SDR).';
    end if;
  end if;
  -- Só o `dono_email` muda; o `google_agenda_id` (e o resto) fica como está.
  insert into public.app_settings (key, value, description)
  values ('calendly', jsonb_build_object('dono_email', v_email),
          'O Calendly da Imova: dono_email (quem atende o que chega pelo Calendly) e google_agenda_id (o Google Agenda que o Calendly confere e que o CRM espelha).')
  on conflict (key) do update set value = public.app_settings.value || jsonb_build_object('dono_email', v_email);
  return public.calendly_quem_atende();
end $$;
comment on function public.calendly_quem_atende_gravar(uuid) is
  'Grava em app_settings[calendly].dono_email o e-mail da pessoa que atende o que chega pelo Calendly (só admin; pessoa ativa, admin, gestor ou SDR). Nulo volta ao padrão (o anfitrião do Calendly).';

-- ---------------------------------------------------------------------
-- 9. Quem chama o quê
-- ---------------------------------------------------------------------
revoke all on function app.calendly_pessoa_escolhida() from public, anon, authenticated;
revoke all on function app.calendly_ficha(text, text, text, uuid) from public, anon, authenticated;
revoke all on function app.calendly_codigo_do_anuncio(text) from public, anon, authenticated;
revoke all on function app.calendly_local_da_visita(jsonb) from public, anon, authenticated;
revoke all on function public.calendly_receber(jsonb) from public, anon, authenticated;
revoke all on function public.calendly_cancelamentos_pendentes(int) from public, anon, authenticated;
revoke all on function public.calendly_cancelamentos_que_falharam() from public, anon;
revoke all on function public.calendly_cancelamento_resolvido(uuid) from public, anon;
revoke all on function public.calendly_quem_atende() from public, anon;
revoke all on function public.calendly_quem_atende_gravar(uuid) from public, anon;
grant execute on function public.calendly_receber(jsonb) to service_role;
grant execute on function public.calendly_cancelamentos_pendentes(int) to service_role;
grant execute on function public.calendly_cancelamentos_que_falharam() to authenticated, service_role;
grant execute on function public.calendly_cancelamento_resolvido(uuid) to authenticated, service_role;
grant execute on function public.calendly_quem_atende() to authenticated, service_role;
grant execute on function public.calendly_quem_atende_gravar(uuid) to authenticated, service_role;

  $ddl$;
end $protegida$;

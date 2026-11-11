-- =====================================================================
-- O lead do portal avisa a equipe, e quem escreveu sem dizer o tipo entra
-- como lead — só na Imova (11/11/2026)
--
-- Pedido do usuário em 11/11/2026: "O lead deve aparecer na aba de leads em
-- anúncios e devemos ser notificados que um novo lead chega."
--
-- Até aqui, o lead que escrevia pelo portal (chat, formulário, pedido de
-- visita) entrava na aba Leads e ganhava ficha, mas ninguém era avisado: não
-- tinha conversa de WhatsApp, então não passava pelo aviso de mensagem nova, e
-- o aviso "Lead novo dos portais", aprovado na entrevista de 06/11/2026, nunca
-- tinha sido feito. Agora:
--
--   1. QUANDO O LEAD ESCREVEU. `portal_leads.escreveu_em` guarda o momento em
--      que o lead passou a contar como "escreveu pelo portal": na chegada, ou
--      quando um aviso seguinte do mesmo lead traz a mensagem (clicou antes,
--      escreveu depois). Quem grava é um gatilho na própria tabela, então vale
--      para qualquer caminho de `public.grupozap_lead_receber`.
--   2. ESCREVEU SEM DIZER O TIPO. O Grupo OLX manda o tipo em
--      `extraData.leadType`. Lead com mensagem e sem tipo (ou com um tipo que o
--      CRM não conhece) caía em "Clicaram e não chamaram", sem ficha e com a
--      mensagem escondida. Agora ele ganha o tipo `MENSAGEM_NO_PORTAL`, conta
--      como mensagem pelo portal e ganha a ficha, como chat e formulário.
--   3. O AVISO NO CELULAR. O tipo `lead_portal` entra no catálogo da Imova
--      ("Lead novo dos portais"), e a rodada de 10 segundos dos avisos põe na
--      fila um aviso para cada pessoa que atende (admin, gestor e SDR ativos),
--      com o nome, o que a pessoa fez e o código do anúncio. O toque abre a aba
--      Leads com o lead aberto. Cada pessoa pode desligar em "Avisos no
--      celular", como os outros.
--
-- O aviso no computador (cartão, som e notificação do sistema) e o número ao
-- lado de Anúncios no menu ficam no site: `components/anuncios/leads/vigia-de-leads`.
--
-- Quem clicou no WhatsApp do anúncio e depois mandou mensagem pelo WhatsApp não
-- ganha este aviso: a mensagem dele já avisa todos que atendem pelo aviso de
-- mensagem nova, na hora em que chega.
--
-- ===========================================================================
-- O WHATSAPP NÃO É TOCADO
-- ===========================================================================
-- Nada aqui grava em `messages` ou `conversations` nem cria gatilho nelas. O
-- gatilho novo é em `portal_leads`.
--
-- COMO DESFAZER (no banco da Imova): reaplicar as funções
-- app.portal_lead_mandou_mensagem e public.grupozap_lead_receber da
-- 20261105130000, app.avisos_catalogo e app.avisos_push_rodar da 20261106210000
-- e a restrição push_fila_tipo_check sem 'lead_portal'; drop trigger
-- portal_leads_escreveu on public.portal_leads; drop das funções
-- app.portal_leads_marcar_escreveu() e app.avisos_push_varrer_leads(); alter
-- table public.portal_leads drop column escreveu_em. Os leads com o tipo
-- MENSAGEM_NO_PORTAL continuam com a ficha que ganharam.
-- =====================================================================

do $leads$
begin
  if (select i.empresa from app.identidade i) = 'komune' then
    raise notice 'Os leads dos portais são só da Imova: no banco da KOMUNE a parte dos leads não foi criada.';
    return;
  end if;
  execute $ddl$

-- =====================================================================
-- 1. Quando o lead escreveu
-- =====================================================================
alter table public.portal_leads add column if not exists escreveu_em timestamptz;
comment on column public.portal_leads.escreveu_em is
  'Quando o lead passou a contar como "escreveu pelo portal" (chat, formulário, pedido de visita ou mensagem sem tipo). Gravado pelo gatilho portal_leads_escreveu; é o que o aviso de lead novo olha (11/11/2026).';
create index if not exists portal_leads_escreveu_idx on public.portal_leads (escreveu_em desc)
  where escreveu_em is not null;

-- Os tipos de contato em que a pessoa escreveu alguma coisa no próprio portal.
-- MENSAGEM_NO_PORTAL é o tipo que o CRM dá ao lead com mensagem e sem tipo.
create or replace function app.portal_lead_mandou_mensagem(p_tipos text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_tipos && array['CONTACT_CHAT', 'CONTACT_FORM', 'VISIT_REQUEST',
                                   'MENSAGEM_NO_PORTAL']::text[], false)
$$;
comment on function app.portal_lead_mandou_mensagem(text[]) is
  'O lead escreveu pelo portal (chat, formulário, pedido de visita, ou mensagem sem tipo, MENSAGEM_NO_PORTAL)? Clique no WhatsApp, ver telefone e agendar não são mensagem.';
revoke all on function app.portal_lead_mandou_mensagem(text[]) from public, anon;
grant execute on function app.portal_lead_mandou_mensagem(text[]) to authenticated, service_role;

create or replace function app.portal_leads_marcar_escreveu()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.escreveu_em is null and app.portal_lead_mandou_mensagem(new.tipos) then
    new.escreveu_em := now();
  end if;
  return new;
end $$;
comment on function app.portal_leads_marcar_escreveu() is
  'Gatilho de public.portal_leads: grava escreveu_em na primeira vez em que os tipos do lead contam como mensagem pelo portal.';
revoke all on function app.portal_leads_marcar_escreveu() from public, anon, authenticated;

drop trigger if exists portal_leads_escreveu on public.portal_leads;
create trigger portal_leads_escreveu
  before insert or update of tipos on public.portal_leads
  for each row execute function app.portal_leads_marcar_escreveu();

-- Os que já tinham escrito: a data da chegada. Ficam para trás do aviso, que
-- só olha os últimos minutos.
update public.portal_leads
   set escreveu_em = recebido_em
 where escreveu_em is null
   and app.portal_lead_mandou_mensagem(tipos);

-- =====================================================================
-- 2. Receber: quem escreveu sem dizer o tipo também é lead
-- =====================================================================
-- A função da 20261105130000, com três mudanças marcadas "11/11/2026": o tipo
-- MENSAGEM_NO_PORTAL, o texto da atividade e os tipos somados de uma vez no
-- aviso repetido.
create or replace function public.grupozap_lead_receber(p_chave text, p_lead jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_chave    text := btrim(coalesce(p_chave, ''));
  v_extra    jsonb;
  v_origem   text;
  v_mcmv     boolean;
  v_cod      text;
  v_cod_port text;
  v_tipo     text;
  v_legivel  text;
  v_temp     text;
  v_trans    text;
  v_lc       jsonb;
  v_certo    boolean;
  v_msg      text;
  v_link     text;
  v_quando   timestamptz;
  v_payload  jsonb;
  v_minimo   jsonb;
  v_anuncio  uuid;
  v_manual   uuid;
  v_trazido  uuid;
  v_an_sit   text;
  v_id       uuid;
  v_lead     public.portal_leads%rowtype;
  v_repetido boolean := false;
  v_tel      text;
  v_email    text;
  v_nome     text;
  v_supr     boolean;
  v_ficha    text;
  v_tipo_novo boolean := false;
  v_k        public.portal_lead_contatos%rowtype;
  -- 11/11/2026: escreveu e o portal não disse como; e os tipos deste aviso.
  v_sem_tipo boolean := false;
  v_novos    text[];
begin
  if v_chave = '' or char_length(v_chave) > 200 then
    return jsonb_build_object('ok', false, 'motivo', 'chave_invalida');
  end if;
  if jsonb_typeof(p_lead) is distinct from 'object' then
    return jsonb_build_object('ok', false, 'motivo', 'lead_invalido');
  end if;
  v_extra := case when jsonb_typeof(p_lead -> 'extraData') = 'object' then p_lead -> 'extraData'
                  else '{}'::jsonb end;

  -- ---- O que o lead diz ----
  v_origem := left(nullif(btrim(p_lead ->> 'leadOrigin'), ''), 80);
  v_mcmv := coalesce(v_origem ~* 'mcmv', false)
            or coalesce(jsonb_typeof(v_extra -> 'mcmv') = 'object', false)
            or coalesce((v_extra -> 'mcmv') = 'true'::jsonb, false);
  v_cod := left(nullif(btrim(p_lead ->> 'clientListingId'), ''), 100);
  v_cod_port := left(nullif(btrim(p_lead ->> 'originListingId'), ''), 100);
  v_tipo := upper(btrim(v_extra ->> 'leadType'));
  if v_tipo !~ '^[A-Z_]{1,40}$' then
    v_tipo := null;
  end if;
  v_temp := left(nullif(btrim(p_lead ->> 'temperature'), ''), 20);
  v_trans := left(nullif(upper(btrim(p_lead ->> 'transactionType')), ''), 20);
  v_lc := v_extra -> 'leadCerto';
  v_certo := case jsonb_typeof(v_lc)
               when 'boolean' then v_lc = 'true'::jsonb
               when 'string' then lower(btrim(v_lc #>> '{}')) in ('true', '1', 'sim')
               when 'number' then (v_lc #>> '{}') = '1'
               else false end;
  v_msg := left(app.sem_cpf(p_lead ->> 'message'), 2000);

  -- 11/11/2026: escreveu alguma coisa e o tipo não veio, ou veio um que o CRM
  -- não conhece. Conta como mensagem pelo portal: é gente que escreveu.
  v_sem_tipo := nullif(btrim(coalesce(v_msg, '')), '') is not null
                and (v_tipo is null
                     or v_tipo <> all (array['CLICK_WHATSAPP', 'PHONE_VIEW', 'CONTACT_CHAT',
                                             'CONTACT_FORM', 'VISIT_REQUEST', 'CLICK_SCHEDULE']));
  v_novos := array_remove(array[v_tipo, case when v_sem_tipo then 'MENSAGEM_NO_PORTAL' end], null);

  v_link := btrim(v_extra ->> 'izi');
  if v_link !~* '^https?://[^\s]+$' or char_length(v_link) > 500 then
    v_link := null;
  end if;
  begin
    v_quando := nullif(btrim(p_lead ->> 'timestamp'), '')::timestamptz;
  exception when others then
    v_quando := null;
  end;

  -- O contato, que vai para `portal_lead_contatos` (e nunca para o payload).
  v_tel := coalesce(app.normalize_phone_br(nullif(coalesce(p_lead ->> 'ddd', '') || coalesce(p_lead ->> 'phone', ''), '')),
                    app.normalize_phone_br(p_lead ->> 'phone'),
                    app.normalize_phone_br(p_lead ->> 'phoneNumber'));
  v_email := lower(btrim(p_lead ->> 'email'));
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 254 then
    v_email := null;
  end if;
  v_nome := left(nullif(btrim(regexp_replace(coalesce(app.sem_cpf(p_lead ->> 'name'), ''), '\s+', ' ', 'g')), ''), 120);
  -- Telefone que pediu para sair: o lead fica marcado, sem contato nenhum.
  v_supr := v_tel is not null and app.is_suppressed(v_tel);

  -- O JSON sem nome, e-mail, telefone e mensagem, e sem a simulação do MCMV.
  v_payload := p_lead - array['name', 'email', 'ddd', 'phone', 'phoneNumber', 'message'];
  v_payload := v_payload - coalesce((select array_agg(k) from jsonb_object_keys(v_payload) k
                                      where k ~* '(cpf|cnpj)'), '{}'::text[]);
  if jsonb_typeof(v_payload -> 'extraData') = 'object' then
    v_extra := v_payload -> 'extraData';
    v_extra := v_extra - coalesce((select array_agg(k) from jsonb_object_keys(v_extra) k
                                    where k ~* '(cpf|cnpj)'), '{}'::text[]);
    if v_extra ? 'mcmv' then
      v_extra := (v_extra - 'mcmv') || jsonb_build_object('mcmv', 'omitido');
    end if;
    v_payload := jsonb_set(v_payload, '{extraData}', v_extra);
  end if;
  v_minimo := jsonb_strip_nulls(jsonb_build_object(
    'leadOrigin', v_origem, 'timestamp', p_lead ->> 'timestamp', 'originLeadId', v_chave,
    'originListingId', v_cod_port, 'clientListingId', v_cod, 'temperature', v_temp,
    'transactionType', v_trans,
    'extraData', jsonb_strip_nulls(jsonb_build_object('leadType', v_tipo, 'leadCerto', v_certo,
                                                      'mcmv', case when v_mcmv then 'omitido' end)),
    'resumido', true));
  if app.tem_cpf(v_payload::text) then
    begin
      v_payload := coalesce(app.sem_cpf(v_payload::text)::jsonb, v_minimo);
    exception when others then
      v_payload := v_minimo;
    end;
  end if;
  if octet_length(v_payload::text) > 20000 then
    v_payload := v_minimo;
  end if;

  -- ---- O anúncio: primeiro o do CRM, depois o do relatório do Canal Pro ----
  if v_cod is null then
    v_an_sit := 'sem_codigo';
  else
    select a.id into v_anuncio from public.anuncios a
     where a.codigo = v_cod and a.excluido_em is null;
    select m.id, m.anuncio_id into v_manual, v_trazido
      from public.anuncios_no_canal_pro m
     where m.codigo = v_cod;
    if v_anuncio is null and v_trazido is not null
       and exists (select 1 from public.anuncios a where a.id = v_trazido and a.excluido_em is null) then
      v_anuncio := v_trazido;
    end if;
    v_an_sit := case when v_anuncio is not null or v_manual is not null then 'encontrado'
                     else 'nao_encontrado' end;
  end if;

  -- ---- Uma vez só ----
  insert into public.portal_leads as l
    (origin_lead_id, origem_no_portal, client_listing_id, origin_listing_id, anuncio_id,
     anuncio_no_canal_pro_id, tipos, temperatura, transacao, lead_certo, mcmv, mensagem,
     link_historico, recebido_no_portal_em, payload, suprimido)
  values
    (v_chave, v_origem, v_cod, v_cod_port, v_anuncio, v_manual,
     v_novos,
     v_temp, v_trans, v_certo, v_mcmv, v_msg, v_link, v_quando, v_payload, v_supr)
  on conflict (origem, origin_lead_id) do nothing
  returning l.id into v_id;

  if v_id is null then
    select l.* into v_lead from public.portal_leads l
     where l.origem = 'grupo_olx' and l.origin_lead_id = v_chave
     for update;
    v_id := v_lead.id;
    v_cod := coalesce(v_cod, v_lead.client_listing_id);
    v_mcmv := v_mcmv or v_lead.mcmv;
    v_trans := coalesce(v_trans, v_lead.transacao);
    v_repetido := true;
  end if;

  -- 11/11/2026: a mensagem sem tipo vem antes do nome cru de um tipo desconhecido.
  v_legivel := coalesce(case when v_sem_tipo then 'mandou mensagem pelo portal' end,
                        case v_tipo
                          when 'CLICK_WHATSAPP' then 'clicou no WhatsApp'
                          when 'PHONE_VIEW'     then 'viu o telefone'
                          when 'CONTACT_CHAT'   then 'mandou mensagem pelo chat'
                          when 'CONTACT_FORM'   then 'preencheu o formulário'
                          when 'VISIT_REQUEST'  then 'pediu uma visita'
                          when 'CLICK_SCHEDULE' then 'quis agendar uma visita'
                          else lower(replace(v_tipo, '_', ' ')) end,
                        'contato')
               || case when v_mcmv then ', Minha Casa Minha Vida' else '' end;

  -- ---- O contato que o portal mandou (o que faltava é completado) ----
  if v_repetido and (v_lead.suprimido or v_lead.contato_apagado_em is not null) then
    null;
  elsif v_supr then
    if v_repetido then
      update public.portal_leads set suprimido = true where id = v_id and not suprimido;
      delete from public.portal_lead_contatos where lead_id = v_id;
    end if;
  elsif v_tel is not null or v_email is not null or v_nome is not null then
    insert into public.portal_lead_contatos as k (lead_id, nome, telefone_e164, email)
    values (v_id, v_nome, v_tel, v_email)
    on conflict (lead_id) do update
      set nome          = coalesce(k.nome, excluded.nome),
          telefone_e164 = coalesce(k.telefone_e164, excluded.telefone_e164),
          email         = coalesce(k.email, excluded.email);
  end if;

  if v_repetido then
    -- 11/11/2026: os tipos deste aviso (o do portal e, se for o caso, o
    -- MENSAGEM_NO_PORTAL) entram juntos, só os que faltam.
    if cardinality(v_novos) > 0 then
      update public.portal_leads l
         set tipos = l.tipos || array(select t from unnest(v_novos) as t
                                       where not (t = any (l.tipos)))
       where l.id = v_id
         and not (v_novos <@ l.tipos)
         and cardinality(l.tipos) + cardinality(v_novos) <= 20;
      v_tipo_novo := found;
    end if;
    if v_tipo_novo and v_lead.organization_id is not null then
      -- O tipo novo é contado na ficha que o lead já tem.
      insert into public.activities (type, organization_id, deal_id, user_id, author_kind, body, metadata)
      values ('system', v_lead.organization_id, app.wa_negocio_da_ficha(v_lead.organization_id), null, 'system',
              format('Lead do portal: anúncio %s (%s)', coalesce(v_cod, 'sem código'), v_legivel),
              jsonb_build_object('origin', 'portal_lead', 'portal_lead_id', v_id,
                                 'tipo', coalesce(v_tipo, 'MENSAGEM_NO_PORTAL'), 'repetido', true));
    elsif v_tipo_novo and v_lead.organization_id is null and not v_lead.suprimido and not v_supr
          and app.portal_lead_mandou_mensagem(v_novos) then
      -- Clicou antes, escreveu agora: só agora ganha a ficha.
      select k.* into v_k from public.portal_lead_contatos k where k.lead_id = v_id;
      perform app.portal_lead_ligar_ficha(v_id, v_k.telefone_e164, v_k.email, v_k.nome, v_trans,
                format('Lead do portal: anúncio %s (%s)', coalesce(v_cod, 'sem código'), v_legivel));
    end if;
    return jsonb_build_object('ok', true, 'duplicado', true, 'lead_id', v_id);
  end if;

  -- ---- A ficha: só para quem escreveu pelo portal ----
  if v_supr then
    v_ficha := 'suprimida';
  elsif app.portal_lead_mandou_mensagem(v_novos) then
    v_ficha := app.portal_lead_ligar_ficha(v_id, v_tel, v_email, v_nome, v_trans,
                 format('Lead do portal: anúncio %s (%s)', coalesce(v_cod, 'sem código'), v_legivel));
  else
    -- Clicou no WhatsApp, viu o telefone ou quis agendar: espera a mensagem.
    v_ficha := 'aguarda_mensagem';
  end if;

  return jsonb_build_object('ok', true, 'duplicado', false, 'lead_id', v_id,
                            'anuncio', v_an_sit, 'ficha', v_ficha);
end $$;
comment on function public.grupozap_lead_receber(text, jsonb) is
  'Recebe um lead do webhook do Grupo OLX (só a Edge Function grupozap-lead, com a chave de serviço). Idempotente pela chave (originLeadId); liga ao anúncio pelo código; guarda o contato à parte (portal_lead_contatos). Só quem escreveu pelo portal (chat, formulário, visita, ou mensagem sem tipo, que vira MENSAGEM_NO_PORTAL) ganha ficha na hora; quem clicou no WhatsApp entra quando a mensagem chega (portal_leads_na_lista). Telefone suprimido não guarda contato. Não envia nada.';
revoke all on function public.grupozap_lead_receber(text, jsonb) from public, anon, authenticated;
grant execute on function public.grupozap_lead_receber(text, jsonb) to service_role;

-- =====================================================================
-- 3. O aviso no celular: lead que acabou de escrever
-- =====================================================================
-- Para todos que atendem: o lead do portal não tem dono quando chega. Olhar
-- dois minutos para trás a cada 10 segundos cobre a transação que gravou com
-- um horário anterior; a chave única impede o aviso dobrado. O descartado e o
-- suprimido não avisam.
create or replace function app.avisos_push_varrer_leads()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  insert into app.push_fila (pessoa_id, tipo, chave, corpo, caminho)
  select q.pessoa, 'lead_portal', 'lead_portal:' || l.id || ':' || q.pessoa,
         left('Novo lead: '
              || coalesce(nullif(btrim(o.name), ''), nullif(btrim(k.nome), ''), 'alguém')
              || ' ' || case when 'VISIT_REQUEST' = any (l.tipos) then 'pediu uma visita'
                             when 'CONTACT_FORM' = any (l.tipos) then 'preencheu o formulário'
                             when 'CONTACT_CHAT' = any (l.tipos) then 'mandou mensagem pelo chat'
                             else 'escreveu pelo portal' end
              || coalesce(' · ' || l.client_listing_id, ''), 240),
         '/anuncios/leads?lead=' || l.id
    from public.portal_leads l
    left join public.organizations o on o.id = l.organization_id
    left join public.portal_lead_contatos k on k.lead_id = l.id
   cross join app.avisos_quem_atende() as q (pessoa)
   where l.escreveu_em > now() - interval '2 minutes'
     and not l.suprimido
     and l.situacao <> 'descartado'
  on conflict (chave) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
comment on function app.avisos_push_varrer_leads() is
  'Põe na fila o aviso "Novo lead" para todos que atendem, quando um lead do portal acaba de escrever (portal_leads.escreveu_em). Chamada por app.avisos_push_rodar, só na Imova.';
revoke all on function app.avisos_push_varrer_leads() from public, anon, authenticated;

  $ddl$;
end $leads$;

-- =====================================================================
-- 4. O catálogo, a fila e a rodada (as duas empresas: o tipo novo só aparece
--    no catálogo da Imova, e a rodada só chama a varredura dos leads lá)
-- =====================================================================
alter table app.push_fila drop constraint if exists push_fila_tipo_check;
alter table app.push_fila add constraint push_fila_tipo_check
  check (tipo in ('mensagem', 'transferencia', 'compromisso', 'lembrete', 'atrasada', 'resumo',
                  'lote', 'reuniao_robo', 'publicado', 'ligando', 'ligacao_perdida',
                  'lead_portal'));

create or replace function app.avisos_catalogo()
returns table (tipo text, nome text, descricao text, ordem integer)
language sql stable
set search_path = ''
as $$
  select v.tipo, v.nome, v.descricao, v.ordem
    from (values
      ('mensagem',        'Mensagem nova',              'Quando um cliente ou parceiro escreve no WhatsApp.',            1, null),
      ('transferencia',   'Conversa transferida',       'Quando alguém passa uma conversa para você.',                   2, null),
      ('compromisso',     'Compromisso marcado',        'Quando alguém marca uma reunião ou visita para você.',          3, null),
      ('lembrete',        'Lembrete de compromisso',    '30 minutos antes de cada reunião ou visita sua.',               4, null),
      ('atrasada',        'Resposta atrasada',          'Quando uma conversa espera a nossa resposta há 24 horas.',      5, null),
      ('resumo',          'Resumo das 8h',              'Um aviso por manhã com o que espera você no dia.',              6, null),
      ('lote',            'Lote para ligar',            'Quando a gestão monta ou passa um lote de ligações para você.', 7, 'komune'),
      ('reuniao_robo',    'Reunião marcada pelo robô',  'Quando o robô marca uma reunião com um parceiro seu.',          8, 'komune'),
      ('publicado',       'Parceiro publicado',         'Quando um parceiro seu é publicado na Komune.',                 9, 'komune'),
      ('ligando',         'Cliente ligando',            'Na hora em que um cliente liga pelo WhatsApp, enquanto toca.', 10, 'imova'),
      ('ligacao_perdida', 'Ligação perdida',            'Quando um cliente liga pelo WhatsApp e ninguém atende.',       11, 'imova'),
      ('lead_portal',     'Lead novo dos portais',      'Quando alguém escreve num anúncio do ZAP, do Viva Real ou da OLX.', 12, 'imova')
    ) as v (tipo, nome, descricao, ordem, empresa)
   where v.empresa is null or v.empresa = (select i.empresa from app.identidade i limit 1);
$$;
comment on function app.avisos_catalogo() is
  'Os avisos no celular desta empresa (entrevista de 06/11/2026; lead novo dos portais em 11/11/2026): os comuns e os só dela.';
revoke all on function app.avisos_catalogo() from public, anon, authenticated;

-- A rodada da 20261106210000, com a varredura dos leads depois da varredura comum.
-- A chamada é dinâmica: no banco da KOMUNE a função dos leads não existe.
create or replace function app.avisos_push_rodar() returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_novos    integer := 0;
  v_enviados integer := 0;
  v_apagados integer := 0;
  v_leads    integer := 0;
begin
  if not app.avisos_push_ligados() then
    return jsonb_build_object('ligado', false);
  end if;
  begin v_apagados := app.avisos_push_conferir();
  exception when others then raise warning 'avisos_push_conferir: %', sqlerrm; end;
  begin v_novos := app.avisos_push_varrer();
  exception when others then raise warning 'avisos_push_varrer: %', sqlerrm; end;
  if app.avisos_empresa() = 'imova'
     and to_regprocedure('app.avisos_push_varrer_leads()') is not null then
    begin
      execute 'select app.avisos_push_varrer_leads()' into v_leads;
      v_novos := v_novos + coalesce(v_leads, 0);
    exception when others then raise warning 'avisos_push_varrer_leads: %', sqlerrm; end;
  end if;
  begin v_enviados := app.avisos_push_enviar();
  exception when others then raise warning 'avisos_push_enviar: %', sqlerrm; end;
  -- A fila e os envios guardam uma semana: é registro de aviso, não histórico.
  delete from app.push_fila where criado_em < now() - interval '7 days';
  delete from app.push_envios where enviado_em < now() - interval '7 days';
  return jsonb_build_object('ligado', true, 'novos', v_novos, 'enviados', v_enviados,
                            'aparelhos_esquecidos', v_apagados);
end $$;
comment on function app.avisos_push_rodar() is
  'A rodada dos avisos no celular, a cada 10 segundos pelo pg_cron: confere as respostas do Expo, varre o que aconteceu (e, na Imova, os leads novos dos portais) e manda o que estiver na fila.';
revoke all on function app.avisos_push_rodar() from public, anon, authenticated;

-- =====================================================================
-- O convite da Agenda: o link pessoal do Calendly que a IA ou a equipe manda
-- na conversa, e o imóvel de toda visita — só na Imova (11/11/2026)
--
-- Pedido do usuário: "Quero focar na agenda agora para deixar ela
-- completamente integrada e funcional no projeto. Preciso que a IA envie o
-- link da agenda para o cliente marcar o horário da visita ao local ou horário
-- da reunião. Caso seja visita presencial, deverá ter o endereço e o código do
-- imóvel/terreno que será tratado."
--
-- Esta é a parte do banco do contrato da Agenda integrada (agente CONVITE).
-- Os nomes, as colunas e as assinaturas são os do contrato; quem usa cada peça
-- é a tela (botão "Enviar link da agenda" em Conversas, "Definir imóvel" na
-- Agenda) e o worker da IA (`atendente-imova@v3`).
--
-- O FLUXO
--   1. Na conversa, a IA (`public.ia_atendente_enviar_link`) ou uma pessoa
--      (`public.agenda_enviar_link`) manda o LINK PESSOAL do Calendly. O banco
--      cria o convite (`agenda_convites`, com um token sorteado) e a mensagem,
--      pelo caminho de sempre: `insert` em `messages`, com a porteira
--      (`messages_guard` → `app.pode_enviar`). O texto é curto, com a linha do
--      imóvel na visita ("Imóvel: IM0003 · Rua X, 10, Ponta Negra, Natal") e o
--      link. O modelo NUNCA escreve URL: quem põe o link é o banco.
--   2. O link leva preenchidos o nome, o tipo ("Visita a um imóvel" ou
--      "Reunião", a opção exata da pergunta), o telefone e, na visita, o código
--      e o endereço do imóvel; e `utm_source=crm`, `utm_medium=whatsapp`,
--      `utm_campaign=ia|equipe`, `utm_content=<token>`. Os parâmetros saem de
--      `app_settings['calendly'].perguntas` (a ordem das perguntas no Calendly:
--      a1, a2, a3) e `.opcoes` (o texto das opções), tudo codificado para URL
--      (`app.url_codificar`, UTF-8, RFC 3986).
--   3. O cliente escolhe o horário. A Edge Function `calendly-webhook` passa o
--      `tracking.utm_content` do convidado (`p_evento.convite`), e
--      `public.calendly_receber` acha o convite: com ele, a FICHA é a da
--      conversa (mesmo que o cliente escreva outro e-mail), o TIPO é o do
--      convite (e não o da resposta), e o IMÓVEL também. O convite vale uma
--      vez, por 30 dias; o mesmo convidado remarcando continua com ele, e ele
--      volta a valer quando o Calendly cancela.
--   4. TODA VISITA TEM IMÓVEL (`visita_imoveis`, uma linha por tarefa `visit`):
--      do convite (origem 'convite'), da resposta "Endereço ou código do
--      imóvel" no Calendly sem convite ('calendly'), marcada na Agenda
--      (`public.visita_marcar_com_imovel`, 'crm'), da IA que ainda marca direto
--      (`public.ia_atendente_marcar_visita`, 'ia'), ou corrigida pela tela
--      (`public.visita_definir_imovel`, 'corrigido'). A visita do Calendly que
--      chega sem imóvel ganha, para o responsável, a tarefa "Confirmar o imóvel
--      da visita com <cliente>", uma vez só; a tela mostra "Falta o imóvel".
--   5. O lembrete da véspera (20261111206000) passa a dizer no {{local}} o
--      imóvel da visita: "Rua X, 10, Ponta Negra, Natal (imóvel IM0003)".
--
-- O QUE NÃO MUDA: feriado e horário ocupado continuam recusando como hoje; a
-- `public.visita_marcar` (a KOMUNE usa) fica intocada; a reunião continua em
-- `public.reunioes`, com o `local` dela; os tipos de aviso do celular
-- (`push_fila_tipo_check`, `app.avisos_*`) não são tocados.
--
-- A IA: `ia_respostas.acao` ganha 'enviou_link' (quem mede "as visitas da IA"
-- conta por ela e por `agenda_convites.pela_ia`), e `app.ia_atendente_dizer`
-- aceita a ação nova. A entrada do worker (`public.ia_entrada_do_atendente`)
-- ganha `convites_da_agenda`: os 5 convites mais novos da conversa.
--
-- A LGPD: o dossiê (`app.lgpd_dossie`) ganha os convites e os imóveis das
-- visitas da ficha, e a retenção (`app.aplicar_retencao`) tira do link o nome
-- e o telefone 90 dias depois de o convite vencer, apaga o convite de ficha
-- anonimizada, e apaga o endereço escrito à mão (sem anúncio) da visita de mais
-- de 12 meses. As duas funções são das duas empresas; aqui elas são trocadas só
-- no banco da Imova, sobre a definição que está no banco (`pg_get_functiondef`
-- + um trecho, a migração aborta se a âncora não estiver lá uma vez só), e as
-- leituras novas passam por `to_regclass`. A exclusão segue a conversa e a
-- tarefa (`on delete cascade`).
--
-- NA KOMUNE NÃO CRIA NADA. Num banco sem identidade (CI, db reset), tudo é
-- criado, para os testes.
--
-- COMO DESFAZER (no banco da Imova):
--   reaplicar public.calendly_receber (20261111204000), app.calendly_config
--   (20261110180000), app.lembrete_visitas_do_periodo (20261111206000),
--   public.ia_atendente_marcar_visita, app.ia_atendente_dizer e
--   public.ia_entrada_do_atendente (20261106170000), app.lgpd_dossie
--   (20261022100000) e app.aplicar_retencao (20260905000200);
--   drop function public.agenda_link_previa(uuid, text, uuid, text),
--     public.agenda_enviar_link(uuid, text, uuid, text),
--     public.ia_atendente_enviar_link(uuid, uuid, text, text, text, bigint, text),
--     public.visita_marcar_com_imovel(uuid, timestamptz, uuid, uuid, uuid, text),
--     public.visita_definir_imovel(uuid, uuid, text), public.calendly_link_configurar(text),
--     app.url_codificar(text), app.agenda_token_novo(), app.anuncio_endereco(uuid),
--     app.agenda_anuncio_do_codigo(text), app.agenda_link_base(jsonb, text),
--     app.agenda_link_montar(jsonb, text, text, text, text, text, text),
--     app.agenda_sem_link(text), app.agenda_texto_do_link(text, text, text, text),
--     app.agenda_ve_conversa(uuid), app.agenda_convite_preparar(uuid, text, uuid, text, text),
--     app.ia_convites_da_agenda(uuid), app.visita_imovel_gravar(uuid, uuid, text, text, text, uuid),
--     app.visita_imovel_local(uuid), app.visita_tarefa_confirmar_imovel(uuid),
--     app.calendly_ficha_do_convite(uuid, text, text, uuid, uuid),
--     app.lgpd_agenda_convites(uuid), app.lgpd_visita_imoveis(uuid);
--   drop table public.agenda_convites, public.visita_imoveis;
--   (a ação 'enviou_link' em ia_respostas.acao pode ficar: não muda nada sozinha);
--   update public.app_settings set value = value - 'link' - 'link_visita' - 'link_reuniao'
--     - 'perguntas' - 'opcoes' where key = 'calendly'.
-- =====================================================================

do $convite$
declare
  v_def    text;
  v_vezes  int;
  v_ancora text;
  v_trecho text;
  v_n      int;
  v_acoes  text[];
begin
  if (select i.empresa from app.identidade i) = 'komune' then
    raise notice 'O convite da Agenda é só da Imova: no banco da KOMUNE nada foi criado.';
    return;
  end if;

  -- -------------------------------------------------------------------
  -- 0. A ação nova da IA (`ia_respostas.acao`): 'enviou_link', sem perder
  --    nenhuma outra. A lista é lida da restrição que está no banco (outra
  --    entrega acrescenta 'retomou' do mesmo jeito, em qualquer ordem).
  -- -------------------------------------------------------------------
  select array_agg(distinct m[1])
    into v_acoes
    from pg_constraint c
    cross join lateral regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') as m
   where c.conname = 'ia_respostas_acao_check'
     and c.conrelid = 'public.ia_respostas'::regclass;
  if v_acoes is null or not 'respondeu' = any (v_acoes) then
    raise exception 'ia_respostas_acao_check não está no banco como esperado: nada foi trocado.';
  end if;
  if not 'enviou_link' = any (v_acoes) then
    alter table public.ia_respostas drop constraint ia_respostas_acao_check;
    execute format('alter table public.ia_respostas add constraint ia_respostas_acao_check check (acao in (%s))',
                   (select string_agg(quote_literal(a), ', ' order by a)
                      from unnest(v_acoes || 'enviou_link'::text) a));
  end if;

  execute $ddl$

-- =====================================================================
-- 1. A configuração do link (app_settings['calendly'])
-- =====================================================================
-- Os padrões por baixo do que está gravado. `link` não tem padrão aqui: sem
-- ele gravado, o envio diz `sem_link_configurado` em vez de mandar um link
-- que ninguém conferiu. O link confirmado pelo usuário é gravado logo abaixo.
create or replace function app.calendly_config()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select '{"dono_email": null, "google_agenda_id": null,
           "link": null, "link_visita": null, "link_reuniao": null,
           "perguntas": {"tipo": "a1", "telefone": "a2", "imovel": "a3"},
           "opcoes": {"visita": "Visita a um imóvel", "reuniao": "Reunião"}}'::jsonb
         || coalesce((select s.value from public.app_settings s where s.key = 'calendly'), '{}'::jsonb)
$$;
comment on function app.calendly_config() is
  'app_settings[calendly] com os padrões por baixo: dono_email (quem atende), google_agenda_id (o espelho), link (o link público do Calendly), link_visita e link_reuniao (um evento por tipo, quando houver; valem no lugar de link), perguntas (o parâmetro de cada pergunta no preenchimento: a ordem delas no Calendly) e opcoes (o texto exato das opções da pergunta do tipo).';

-- Junta ao que existe: o que já está gravado (dono_email, google_agenda_id, um
-- link já trocado) vence o padrão.
insert into public.app_settings (key, value, description)
values ('calendly',
        '{"link": "https://calendly.com/contato-imovaimobiliaria/30min",
          "link_visita": null, "link_reuniao": null,
          "perguntas": {"tipo": "a1", "telefone": "a2", "imovel": "a3"},
          "opcoes": {"visita": "Visita a um imóvel", "reuniao": "Reunião"}}'::jsonb,
        'O Calendly da Imova: dono_email (quem atende o que chega pelo Calendly), google_agenda_id (o Google Agenda que o Calendly confere e que o CRM espelha), link (o link público; mudado só por public.calendly_link_configurar), link_visita e link_reuniao (opcionais, um evento por tipo), perguntas (a1, a2, a3: a ordem das perguntas "O que você quer marcar?", "Telefone (WhatsApp)" e "Endereço ou código do imóvel") e opcoes (o texto exato das opções da primeira).')
on conflict (key) do update
  set value = excluded.value || public.app_settings.value,
      description = excluded.description;

-- O campo do link do Calendly (Agenda, só admin).
create or replace function public.calendly_link_configurar(p_link text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  -- Limpo: sem nada depois do "?" ou do "#" (o link copiado do navegador pode
  -- vir com ?month=...), e sem a barra do fim. O CRM acrescenta os parâmetros dele.
  v_link text := regexp_replace(split_part(split_part(btrim(coalesce(p_link, '')), '#', 1), '?', 1), '/+$', '');
begin
  if auth.uid() is null or not app.is_admin() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  -- Só o link do Calendly.
  if v_link !~ '^https://calendly\.com/[A-Za-z0-9._~-]+(/[A-Za-z0-9._~-]+)*$'
     or char_length(v_link) > 300 then
    return jsonb_build_object('ok', false, 'motivo', 'link_invalido');
  end if;
  insert into public.app_settings (key, value)
  values ('calendly', jsonb_build_object('link', v_link))
  on conflict (key) do update
    set value = public.app_settings.value || jsonb_build_object('link', v_link), updated_at = now();
  return jsonb_build_object('ok', true, 'link', v_link);
end $$;
comment on function public.calendly_link_configurar(text) is
  'Grava app_settings[calendly].link, o link público do Calendly que o convite da Agenda usa (só admin; só https://calendly.com/...). O link é gravado e devolvido limpo, sem nada depois do "?" ou do "#" e sem a barra do fim. Devolve {ok:true, link} ou {ok:false, motivo: link_invalido | sem_permissao}, sem levantar exceção. O resto da configuração fica como está.';


-- =====================================================================
-- 2. As tabelas
-- =====================================================================
create table if not exists public.agenda_convites (
  id                      uuid primary key default gen_random_uuid(),
  -- Vai no link como `utm_content`, e o Calendly devolve no aviso
  -- (`tracking.utm_content` do convidado). Sorteado: ninguém adivinha o de outro.
  token                   text not null unique check (token ~ '^[a-z0-9]{10,16}$'),
  conversation_id         uuid not null references public.conversations (id) on delete cascade,
  organization_id         uuid references public.organizations (id) on delete set null,
  tipo                    text not null check (tipo in ('visita', 'reuniao')),
  anuncio_id              uuid references public.anuncios (id) on delete set null,
  imovel_codigo           text check (char_length(imovel_codigo) <= 60),
  endereco                text check (char_length(endereco) <= 500),
  -- Quem mandou; nulo = a IA (ou a pessoa que saiu do CRM).
  criado_por              uuid references public.profiles (id) on delete set null,
  pela_ia                 boolean not null default false,
  -- O link exato que foi na mensagem.
  link                    text not null check (char_length(link) between 20 and 2000),
  mensagem_id             uuid references public.messages (id) on delete set null,
  criado_em               timestamptz not null default now(),
  expira_em               timestamptz not null default now() + interval '30 days',
  usado_em                timestamptz,
  calendly_agendamento_id uuid references public.calendly_agendamentos (id) on delete set null,
  constraint agenda_convites_visita_tem_endereco check (tipo <> 'visita' or endereco is not null),
  constraint agenda_convites_ia_sem_pessoa check (not pela_ia or criado_por is null)
);
create index if not exists agenda_convites_conversa_idx on public.agenda_convites (conversation_id, criado_em desc);
create index if not exists agenda_convites_org_idx on public.agenda_convites (organization_id);
create index if not exists agenda_convites_agendamento_idx on public.agenda_convites (calendly_agendamento_id)
  where calendly_agendamento_id is not null;

comment on table public.agenda_convites is
  'O convite da Agenda (Imova, 11/11/2026): cada link pessoal do Calendly mandado numa conversa, pela IA ou pela equipe, com o token que volta no aviso do Calendly (utm_content), o tipo e o imóvel. Gravado só pelas funções agenda_enviar_link e ia_atendente_enviar_link, e marcado como usado por calendly_receber. Quem vê a conversa vê o convite.';

alter table public.agenda_convites enable row level security;
drop policy if exists agenda_convites_select on public.agenda_convites;
-- Quem vê a conversa (a RLS de `conversations` vale dentro do `exists`).
create policy agenda_convites_select on public.agenda_convites
  for select to authenticated
  using (exists (select 1 from public.conversations c where c.id = agenda_convites.conversation_id));
revoke all on public.agenda_convites from anon, authenticated, service_role;
grant select on public.agenda_convites to authenticated, service_role;

drop trigger if exists audit_agenda_convites on public.agenda_convites;
create trigger audit_agenda_convites after insert or update or delete on public.agenda_convites
  for each row execute function app.audit();

create table if not exists public.visita_imoveis (
  task_id        uuid primary key references public.tasks (id) on delete cascade,
  -- O nome da FK é o que a tela usa para ler `anuncios(titulo, situacao)`.
  anuncio_id     uuid constraint visita_imoveis_anuncio_id_fkey references public.anuncios (id) on delete set null,
  -- O código do anúncio (IM0003, TE0004_IMOVA...); nulo = imóvel sem anúncio
  -- (a avaliação do imóvel de um proprietário, com o endereço escrito).
  codigo         text check (codigo is null or char_length(codigo) between 1 and 60),
  endereco       text not null check (char_length(btrim(endereco)) between 3 and 500),
  origem         text not null check (origem in ('crm', 'calendly', 'convite', 'ia', 'corrigido')),
  atualizado_em  timestamptz not null default now(),
  atualizado_por uuid references public.profiles (id) on delete set null
);
create index if not exists visita_imoveis_anuncio_idx on public.visita_imoveis (anuncio_id);

comment on table public.visita_imoveis is
  'O imóvel de cada visita (Imova, 11/11/2026): a tarefa visit, o anúncio (código e endereço) ou o endereço escrito, e de onde veio (crm, calendly, convite, ia, corrigido). A visita sem linha aqui é a que a tela mostra como "Falta o imóvel". Gravada só pelas funções; quem vê a tarefa vê o imóvel.';

alter table public.visita_imoveis enable row level security;
drop policy if exists visita_imoveis_select on public.visita_imoveis;
create policy visita_imoveis_select on public.visita_imoveis
  for select to authenticated
  using (exists (select 1 from public.tasks t where t.id = visita_imoveis.task_id));
revoke all on public.visita_imoveis from anon, authenticated, service_role;
grant select on public.visita_imoveis to authenticated, service_role;

drop trigger if exists audit_visita_imoveis on public.visita_imoveis;
create trigger audit_visita_imoveis after insert or update or delete on public.visita_imoveis
  for each row execute function app.audit();


-- =====================================================================
-- 3. O link
-- =====================================================================
-- Codificação para URL: cada byte UTF-8 fora de A-Z a-z 0-9 - _ . ~ vira %XX
-- (RFC 3986). Espaço é %20, e não "+"; "+" é %2B (o "+55" do telefone).
create or replace function app.url_codificar(p_texto text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_bytes bytea;
  v_saida text := '';
  b       int;
begin
  if p_texto is null then
    return null;
  end if;
  v_bytes := convert_to(p_texto, 'UTF8');
  for i in 0 .. length(v_bytes) - 1 loop
    b := get_byte(v_bytes, i);
    if b between 48 and 57 or b between 65 and 90 or b between 97 and 122 or b in (45, 46, 95, 126) then
      v_saida := v_saida || chr(b);
    else
      v_saida := v_saida || '%' || upper(lpad(to_hex(b), 2, '0'));
    end if;
  end loop;
  return v_saida;
end $$;
comment on function app.url_codificar(text) is
  'Codifica um texto para um parâmetro de URL (UTF-8, RFC 3986): letras sem acento, números e - _ . ~ ficam; o resto vira %XX, espaço inclusive (%20).';

-- 12 caracteres de [a-z0-9], sorteados.
create or replace function app.agenda_token_novo()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_letras constant text := 'abcdefghijklmnopqrstuvwxyz0123456789';
  v_bytes  bytea;
  v_token  text;
begin
  loop
    v_bytes := extensions.gen_random_bytes(12);
    select string_agg(substr(v_letras, (get_byte(v_bytes, i) % 36) + 1, 1), '' order by i)
      into v_token from generate_series(0, 11) i;
    exit when not exists (select 1 from public.agenda_convites c where c.token = v_token);
  end loop;
  return v_token;
end $$;

-- O endereço de um anúncio, como a visita acontece: rua e número (sem repetir
-- o número que já está na rua), complemento, bairro, cidade. É a montagem de
-- `app.calendly_codigo_do_anuncio`.
create or replace function app.anuncio_endereco(p_anuncio_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select nullif(concat_ws(', ',
           case when nullif(btrim(coalesce(a.endereco, '')), '') is null then null
                when nullif(btrim(coalesce(a.numero, '')), '') is null
                  or position(btrim(a.numero) in a.endereco) > 0 then btrim(a.endereco)
                else btrim(a.endereco) || ', ' || btrim(a.numero) end,
           nullif(btrim(coalesce(a.complemento, '')), ''),
           nullif(btrim(coalesce(a.bairro, '')), ''),
           nullif(btrim(coalesce(a.cidade, '')), '')), '')
    from public.anuncios a
   where a.id = p_anuncio_id
$$;
comment on function app.anuncio_endereco(uuid) is
  'O endereço de um anúncio para a visita: rua e número, complemento, bairro, cidade. Nulo quando o anúncio não tem nenhum.';

-- O anúncio de um código que a IA escreveu: o código exato primeiro (vale
-- também para os códigos antigos sem tag), e depois a regra do Calendly
-- (`app.calendly_codigo_do_anuncio`: tag e número, com ou sem zeros e sufixo).
create or replace function app.agenda_anuncio_do_codigo(p_codigo text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select a.id from public.anuncios a
      where a.excluido_em is null and nullif(btrim(coalesce(p_codigo, '')), '') is not null
        and upper(btrim(a.codigo)) = upper(btrim(p_codigo))
      order by (a.situacao = 'no_ar') desc, a.updated_at desc
      limit 1),
    (select x.anuncio_id from app.calendly_codigo_do_anuncio(p_codigo) x))
$$;

-- A base do link: o do tipo (`link_visita`, `link_reuniao`) ou o geral.
create or replace function app.agenda_link_base(p_cfg jsonb, p_tipo text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when s.x ~ '^https://[^\s]+$' then s.x end
    from (select coalesce(nullif(btrim(coalesce(p_cfg ->> case when p_tipo = 'visita' then 'link_visita'
                                                              else 'link_reuniao' end, '')), ''),
                          btrim(coalesce(p_cfg ->> 'link', ''))) as x) s
$$;

-- O link pessoal. O preenchimento segue o Calendly ("pre-fill invitee
-- information"): `name`, e as respostas pela ORDEM das perguntas (a1 = a
-- primeira, a2 = a segunda...), que é o que `perguntas` guarda; a opção do tipo
-- vai com o texto exato de `opcoes`. Pergunta sem parâmetro válido (a1..a10)
-- não vai. O rastreio vai nos quatro UTM; `utm_content` é o token.
create or replace function app.agenda_link_montar(
  p_cfg jsonb, p_tipo text, p_nome text, p_telefone text, p_imovel text,
  p_campanha text, p_token text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_base  text := app.agenda_link_base(p_cfg, p_tipo);
  v_perg  jsonb := case when jsonb_typeof(p_cfg -> 'perguntas') = 'object' then p_cfg -> 'perguntas'
                        else '{}'::jsonb end;
  v_opc   jsonb := case when jsonb_typeof(p_cfg -> 'opcoes') = 'object' then p_cfg -> 'opcoes'
                        else '{}'::jsonb end;
  v_par   text[] := '{}'::text[];
  v_usado text[] := '{}'::text[];
  v_campo text;
  v_chave text;
  v_valor text;
begin
  if v_base is null then
    return null;
  end if;
  if nullif(btrim(coalesce(p_nome, '')), '') is not null then
    v_par := array_append(v_par, 'name=' || app.url_codificar(btrim(p_nome)));
  end if;
  foreach v_campo in array array['tipo', 'telefone', 'imovel'] loop
    v_chave := lower(btrim(coalesce(v_perg ->> v_campo, '')));
    v_valor := nullif(btrim(coalesce(case v_campo
                 when 'tipo'     then v_opc ->> p_tipo
                 when 'telefone' then p_telefone
                 when 'imovel'   then case when p_tipo = 'visita' then p_imovel end
               end, '')), '');
    continue when v_valor is null or v_chave !~ '^a([1-9]|10)$' or v_chave = any (v_usado);
    v_usado := array_append(v_usado, v_chave);
    v_par := array_append(v_par, v_chave || '=' || app.url_codificar(v_valor));
  end loop;
  v_par := array_append(v_par, 'utm_source=crm');
  v_par := array_append(v_par, 'utm_medium=whatsapp');
  v_par := array_append(v_par, 'utm_campaign='
                                || app.url_codificar(coalesce(nullif(btrim(coalesce(p_campanha, '')), ''), 'equipe')));
  if nullif(btrim(coalesce(p_token, '')), '') is not null then
    v_par := array_append(v_par, 'utm_content=' || app.url_codificar(btrim(p_token)));
  end if;
  return v_base || case when position('?' in v_base) > 0 then '&' else '?' end
                || array_to_string(v_par, '&');
end $$;
comment on function app.agenda_link_montar(jsonb, text, text, text, text, text, text) is
  'O link pessoal do Calendly: a base (link_visita/link_reuniao ou link) com name, as respostas pela ordem das perguntas (perguntas.tipo com o texto de opcoes, perguntas.telefone, e perguntas.imovel só na visita), utm_source=crm, utm_medium=whatsapp, utm_campaign (ia ou equipe) e utm_content (o token). Tudo codificado por app.url_codificar.';

-- O modelo nunca escreve URL: o que ele escrever de link sai do texto.
create or replace function app.agenda_sem_link(p_texto text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(btrim(regexp_replace(
           regexp_replace(coalesce(p_texto, ''),
                          '(https?://|www\.)[^[:space:]]*|[[:alnum:].-]*calendly\.com[^[:space:]]*', '', 'gi'),
           '[ \t]+', ' ', 'g')), '')
$$;

-- A mensagem: o começo (o que a pessoa ou a IA escreveu, ou o padrão), a linha
-- do imóvel na visita e o link, cada um na sua linha.
create or replace function app.agenda_texto_do_link(p_tipo text, p_comeco text, p_linha text, p_link text)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(nullif(btrim(coalesce(p_comeco, '')), ''),
                  case when p_tipo = 'visita'
                       then 'Para marcar a visita, é só escolher o melhor dia e horário pelo link abaixo. Seus dados já vão preenchidos.'
                       else 'Para marcar a reunião, é só escolher o melhor dia e horário pelo link abaixo. Seus dados já vão preenchidos.'
                  end)
         || E'\n\n'
         || case when p_tipo = 'visita' and nullif(btrim(coalesce(p_linha, '')), '') is not null
                 then 'Imóvel: ' || btrim(p_linha) || E'\n' else '' end
         || p_link
$$;

-- Quem vê a conversa (a mesma conta da RLS de `conversations`).
create or replace function app.agenda_ve_conversa(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.conversations c
     where c.id = p_conversation_id
       and (app.sees_all()
            or c.assignee_id = auth.uid()
            or (app.role() = 'embaixador'::app.user_role and c.organization_id is not null
                and app.org_is_mine(c.organization_id))))
$$;

-- O que as três portas (prévia, envio da equipe, envio da IA) têm em comum: o
-- tipo, o imóvel, a base do link, o nome e o telefone, e o link montado.
create or replace function app.agenda_convite_preparar(
  p_conversation_id uuid, p_tipo text, p_anuncio_id uuid, p_campanha text, p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cfg   jsonb := app.calendly_config();
  c       public.conversations%rowtype;
  a       public.anuncios%rowtype;
  v_org   public.organizations%rowtype;
  v_end   text;
  v_linha text;
  v_nome  text;
  v_tel   text;
  v_aviso text;
begin
  if p_tipo is null or p_tipo not in ('visita', 'reuniao') then
    return jsonb_build_object('ok', false, 'motivo', 'tipo_invalido');
  end if;
  select * into c from public.conversations where id = p_conversation_id;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'conversa_inexistente');
  end if;

  -- A visita tem imóvel: o anúncio (no ar, em rascunho ou pausado; excluído
  -- não), com o endereço dele. A reunião não leva imóvel.
  if p_tipo = 'visita' then
    if p_anuncio_id is null then
      return jsonb_build_object('ok', false, 'motivo', 'visita_sem_imovel');
    end if;
    select * into a from public.anuncios where id = p_anuncio_id;
    if not found or a.excluido_em is not null then
      return jsonb_build_object('ok', false, 'motivo', 'anuncio_invalido');
    end if;
    v_end := app.anuncio_endereco(a.id);
    if v_end is null then
      return jsonb_build_object('ok', false, 'motivo', 'visita_sem_imovel', 'detalhe', 'anuncio_sem_endereco');
    end if;
    v_linha := a.codigo || ' · ' || v_end;
    if a.situacao <> 'no_ar' then
      v_aviso := 'anuncio_nao_esta_no_ar';
    end if;
  end if;

  if app.agenda_link_base(v_cfg, p_tipo) is null then
    return jsonb_build_object('ok', false, 'motivo', 'sem_link_configurado');
  end if;

  if c.organization_id is not null then
    select * into v_org from public.organizations where id = c.organization_id;
  end if;
  v_nome := left(nullif(btrim(regexp_replace(coalesce(app.sem_cpf(
              coalesce(nullif(btrim(v_org.name), ''), nullif(btrim(c.peer_nome), ''))), ''), '\s+', ' ', 'g')), ''), 120);
  v_tel := coalesce(nullif(btrim(c.peer_phone_e164), ''), nullif(btrim(v_org.phone_e164), ''));

  return jsonb_build_object(
           'ok', true, 'tipo', p_tipo, 'organization_id', c.organization_id,
           'anuncio_id', a.id, 'codigo', a.codigo, 'endereco', v_end,
           'titulo', nullif(btrim(coalesce(a.titulo, '')), ''), 'linha', v_linha,
           'link', app.agenda_link_montar(v_cfg, p_tipo, v_nome, v_tel, v_linha, p_campanha, p_token))
         || case when v_aviso is not null then jsonb_build_object('aviso', v_aviso) else '{}'::jsonb end;
end $$;


-- =====================================================================
-- 4. A prévia e o envio pela equipe
-- =====================================================================
-- A prévia e o envio montam o texto pela MESMA função (`app.agenda_texto_do_link`,
-- "começo + linha do imóvel na visita + link"): o que a tela mostra é o que sai.
create or replace function public.agenda_link_previa(
  p_conversation_id uuid, p_tipo text, p_anuncio_id uuid default null, p_texto text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tipo text := lower(btrim(coalesce(p_tipo, '')));
  v_prep jsonb;
begin
  if auth.uid() is null or not app.agenda_ve_conversa(p_conversation_id) then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if char_length(coalesce(p_texto, '')) > 1000 then
    return jsonb_build_object('ok', false, 'motivo', 'texto_longo');
  end if;
  -- Sem token: o convite só nasce no envio. O link da prévia é o mesmo, menos
  -- o `utm_content`.
  v_prep := app.agenda_convite_preparar(p_conversation_id, v_tipo, p_anuncio_id, 'equipe', null);
  if not coalesce((v_prep ->> 'ok')::boolean, false) then
    return v_prep;
  end if;
  return jsonb_build_object(
           'ok', true,
           'texto', app.agenda_texto_do_link(v_tipo, p_texto, v_prep ->> 'linha', v_prep ->> 'link'),
           'link', v_prep ->> 'link',
           'codigo', v_prep ->> 'codigo',
           'endereco', v_prep ->> 'endereco',
           'titulo', v_prep ->> 'titulo')
         || case when v_prep ? 'aviso' then jsonb_build_object('aviso', v_prep ->> 'aviso') else '{}'::jsonb end;
end $$;
comment on function public.agenda_link_previa(uuid, text, uuid, text) is
  'A prévia do botão "Enviar link da agenda" (Imova): o texto que sairia (o começo p_texto, ou o padrão, a linha do imóvel na visita e o link, montado pela mesma função do envio; o link sem o token, que só nasce no envio), o código, o endereço e o título do anúncio. Não grava nada. Quem vê a conversa.';

create or replace function public.agenda_enviar_link(
  p_conversation_id uuid, p_tipo text, p_anuncio_id uuid default null, p_texto text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tipo  text := lower(btrim(coalesce(p_tipo, '')));
  v_token text;
  v_prep  jsonb;
  v_pode  jsonb;
  v_texto text;
  v_msg   uuid;
  v_id    uuid;
begin
  -- Quem pode escrever na conversa: a política `messages_insert`.
  if auth.uid() is null or not app.can_write() or not app.agenda_ve_conversa(p_conversation_id) then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if char_length(coalesce(p_texto, '')) > 1000 then
    return jsonb_build_object('ok', false, 'motivo', 'texto_longo');
  end if;
  -- Um envio por vez na conversa: dois toques no botão não se atropelam.
  perform 1 from public.conversations where id = p_conversation_id for update;

  v_token := app.agenda_token_novo();
  v_prep := app.agenda_convite_preparar(p_conversation_id, v_tipo, p_anuncio_id, 'equipe', v_token);
  if not coalesce((v_prep ->> 'ok')::boolean, false) then
    return v_prep;
  end if;

  -- O link é texto livre: só sai dentro da janela de 24 h desde a última
  -- mensagem do cliente (fora dela, só modelo aprovado, e o modelo não leva link).
  if not app.janela_de_24h_aberta(p_conversation_id, now()) then
    return jsonb_build_object('ok', false, 'motivo', 'fora_da_janela');
  end if;
  v_pode := app.pode_enviar(p_conversation_id, false, false, now());
  if not coalesce((v_pode ->> 'pode')::boolean, false) then
    return jsonb_build_object('ok', false, 'motivo', 'nao_pode_enviar', 'detalhe', v_pode ->> 'motivo');
  end if;

  v_texto := app.agenda_texto_do_link(v_tipo, p_texto, v_prep ->> 'linha', v_prep ->> 'link');
  begin
    -- O caminho normal: a mesma linha que a caixa de resposta grava. A porteira
    -- confere tudo de novo, e a assinatura com o nome de quem manda entra.
    insert into public.messages (conversation_id, direction, type, status, body, author_kind, sent_by, origin)
    values (p_conversation_id, 'out'::app.msg_direction, 'text'::app.msg_type, 'queued'::app.msg_status,
            v_texto, 'human', auth.uid(), 'crm')
    returning id into v_msg;

    insert into public.agenda_convites (token, conversation_id, organization_id, tipo, anuncio_id,
                                        imovel_codigo, endereco, criado_por, pela_ia, link, mensagem_id)
    values (v_token, p_conversation_id, (v_prep ->> 'organization_id')::uuid, v_tipo,
            (v_prep ->> 'anuncio_id')::uuid, v_prep ->> 'codigo', v_prep ->> 'endereco',
            auth.uid(), false, v_prep ->> 'link', v_msg)
    returning id into v_id;
  exception when others then
    return jsonb_build_object('ok', false, 'motivo', 'nao_pode_enviar',
             'detalhe', coalesce(substring(sqlerrm from 'recusad[ao][^:]*: ([a-z_0-9]+)'), left(sqlerrm, 200)));
  end;

  return jsonb_build_object('ok', true, 'mensagem_id', v_msg, 'link', v_prep ->> 'link', 'convite_id', v_id)
         || case when v_prep ? 'aviso' then jsonb_build_object('aviso', v_prep ->> 'aviso') else '{}'::jsonb end;
end $$;
comment on function public.agenda_enviar_link(uuid, text, uuid, text) is
  'O botão "Enviar link da agenda" (Imova): quem pode escrever na conversa cria o convite e manda a mensagem (o começo que a pessoa escreveu, a linha do imóvel na visita e o link pessoal), pelo caminho normal (insert em messages, com a porteira). Só dentro da janela de 24 h.';


-- =====================================================================
-- 5. A IA manda o link
-- =====================================================================
create or replace function public.ia_atendente_enviar_link(
  p_conversation_id uuid, p_em_resposta_a uuid, p_tipo text, p_imovel_codigo text, p_texto text,
  p_ai_run_id bigint default null, p_prompt_version text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tipo    text := lower(btrim(coalesce(p_tipo, '')));
  v_anuncio uuid;
  v_token   text;
  v_prep    jsonb;
  v_comeco  text;
  v_disse   jsonb;
  v_id      uuid := gen_random_uuid();
begin
  if not app.ia_atende(p_conversation_id) then
    return jsonb_build_object('ok', false, 'motivo', 'ia_nao_atende');
  end if;
  if v_tipo not in ('visita', 'reuniao') then
    return jsonb_build_object('ok', false, 'motivo', 'tipo_invalido');
  end if;
  if v_tipo = 'visita' then
    if nullif(btrim(coalesce(p_imovel_codigo, '')), '') is null then
      return jsonb_build_object('ok', false, 'motivo', 'visita_sem_imovel');
    end if;
    v_anuncio := app.agenda_anuncio_do_codigo(p_imovel_codigo);
    if v_anuncio is null then
      return jsonb_build_object('ok', false, 'motivo', 'imovel_desconhecido');
    end if;
  end if;

  v_token := app.agenda_token_novo();
  v_prep := app.agenda_convite_preparar(p_conversation_id, v_tipo, v_anuncio, 'ia', v_token);
  if not coalesce((v_prep ->> 'ok')::boolean, false) then
    return v_prep;
  end if;

  v_comeco := app.agenda_sem_link(p_texto);
  -- O caminho de toda fala da IA: as travas (mensagem nova, já respondida, teto
  -- por hora), o registro em `ia_respostas` (a prova da porteira) e a mensagem
  -- assinada, em fila. No treino e no teste, o mesmo que o `responder`.
  v_disse := app.ia_atendente_dizer(
               p_conversation_id, p_em_resposta_a,
               app.agenda_texto_do_link(v_tipo, v_comeco, v_prep ->> 'linha', v_prep ->> 'link'),
               'enviou_link',
               jsonb_build_object('convite_id', v_id, 'tipo', v_tipo,
                                  'imovel_codigo', v_prep ->> 'codigo', 'anuncio_id', v_anuncio,
                                  'o_modelo_escreveu_link',
                                  coalesce(p_texto, '') ~* '(https?://|www\.|calendly\.com)')
               || case when v_prep ? 'aviso' then jsonb_build_object('aviso', v_prep ->> 'aviso') else '{}'::jsonb end,
               p_ai_run_id, p_prompt_version);
  if not coalesce((v_disse ->> 'ok')::boolean, false) then
    return v_disse;
  end if;

  insert into public.agenda_convites (id, token, conversation_id, organization_id, tipo, anuncio_id,
                                      imovel_codigo, endereco, criado_por, pela_ia, link, mensagem_id)
  values (v_id, v_token, p_conversation_id, (v_prep ->> 'organization_id')::uuid, v_tipo, v_anuncio,
          v_prep ->> 'codigo', v_prep ->> 'endereco', null, true, v_prep ->> 'link',
          (v_disse ->> 'message_id')::uuid);

  return jsonb_build_object('ok', true, 'mensagem_id', (v_disse ->> 'message_id')::uuid,
                            'link', v_prep ->> 'link', 'convite_id', v_id,
                            'resposta_id', (v_disse ->> 'resposta_id')::uuid)
         || case when v_prep ? 'aviso' then jsonb_build_object('aviso', v_prep ->> 'aviso') else '{}'::jsonb end;
end $$;
comment on function public.ia_atendente_enviar_link(uuid, uuid, text, text, text, bigint, text) is
  'Porta do worker de IA (Imova): a IA manda o link pessoal da agenda. O imóvel (na visita) é resolvido pelo código como em app.calendly_codigo_do_anuncio; o banco acrescenta ao texto do modelo a linha do imóvel e o link (o link que o modelo escrever sai). As travas e o registro são os do ia_atendente_responder (ação enviou_link); o convite nasce com pela_ia.';

-- O que a IA vê: os convites da conversa.
create or replace function app.ia_convites_da_agenda(p_conversation_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'tipo', x.tipo, 'imovel_codigo', x.imovel_codigo, 'enviado_em', x.criado_em,
           'agendado', x.agendado) order by x.criado_em desc), '[]'::jsonb)
    from (select ac.tipo, ac.imovel_codigo, ac.criado_em,
                 exists (select 1 from public.calendly_agendamentos ca
                          where ca.id = ac.calendly_agendamento_id and ca.situacao = 'agendado') as agendado
            from public.agenda_convites ac
           where ac.conversation_id = p_conversation_id
           order by ac.criado_em desc
           limit 5) x
$$;
comment on function app.ia_convites_da_agenda(uuid) is
  'Os 5 convites da Agenda mais novos da conversa, para a entrada da IA: tipo, código do imóvel, quando foi mandado e se o cliente já agendou (o agendamento do Calendly está de pé).';


-- =====================================================================
-- 6. O imóvel da visita
-- =====================================================================
create or replace function app.visita_imovel_gravar(
  p_task_id uuid, p_anuncio_id uuid, p_codigo text, p_endereco text, p_origem text, p_por uuid)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.visita_imoveis (task_id, anuncio_id, codigo, endereco, origem, atualizado_em, atualizado_por)
  values (p_task_id, p_anuncio_id, nullif(btrim(coalesce(p_codigo, '')), ''), left(btrim(p_endereco), 500),
          p_origem, now(), p_por)
  on conflict (task_id) do update
     set anuncio_id = excluded.anuncio_id, codigo = excluded.codigo, endereco = excluded.endereco,
         origem = excluded.origem, atualizado_em = now(), atualizado_por = excluded.atualizado_por
$$;

-- O {{local}} do lembrete e o que a ficha mostra: o endereço e, quando há, o código.
create or replace function app.visita_imovel_local(p_task_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select btrim(vi.endereco) || coalesce(' (imóvel ' || vi.codigo || ')', '')
    from public.visita_imoveis vi where vi.task_id = p_task_id
$$;

-- "Confirmar o imóvel da visita com <cliente>", para o responsável da visita,
-- uma vez só: não nasce de novo enquanto houver uma aberta para a mesma ficha.
create or replace function app.visita_tarefa_confirmar_imovel(p_task_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  t        public.tasks%rowtype;
  v_nome   text;
  v_titulo text;
  v_id     uuid;
begin
  select * into t from public.tasks where id = p_task_id;
  if not found or t.organization_id is null
     or exists (select 1 from public.visita_imoveis vi where vi.task_id = p_task_id) then
    return null;
  end if;
  select o.name into v_nome from public.organizations o where o.id = t.organization_id;
  v_titulo := left('Confirmar o imóvel da visita com ' || coalesce(nullif(btrim(v_nome), ''), 'o cliente'), 200);
  if exists (select 1 from public.tasks x
              where x.organization_id = t.organization_id and x.title = v_titulo
                and x.status in ('todo'::app.task_status, 'doing'::app.task_status)) then
    return null;
  end if;
  begin
    insert into public.tasks (title, kind, status, priority, due_at, assignee_id,
                              organization_id, deal_id, contact_id, origin)
    values (v_titulo, 'message'::app.task_kind, 'todo'::app.task_status, 1, now(), t.assignee_id,
            t.organization_id, t.deal_id, t.contact_id, 'system')
    returning id into v_id;
  exception when others then
    -- Contato suprimido não ganha tarefa (o gatilho de tasks recusa).
    raise warning 'visita_tarefa_confirmar_imovel: tarefa não criada: %', sqlerrm;
    return null;
  end;
  return v_id;
end $$;

-- Marcar visita na Agenda com o imóvel (o "Novo compromisso" da Imova).
create or replace function public.visita_marcar_com_imovel(
  p_organization_id uuid, p_inicio timestamptz, p_deal_id uuid default null,
  p_dono uuid default null, p_anuncio_id uuid default null, p_endereco text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  a        public.anuncios%rowtype;
  v_end    text := left(nullif(btrim(regexp_replace(coalesce(app.sem_cpf(p_endereco), ''), '\s+', ' ', 'g')), ''), 500);
  v_codigo text;
  v_r      jsonb;
begin
  if auth.uid() is null or not app.can_write() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if p_anuncio_id is not null then
    select * into a from public.anuncios where id = p_anuncio_id;
    if not found or a.excluido_em is not null then
      return jsonb_build_object('ok', false, 'motivo', 'anuncio_invalido');
    end if;
    v_codigo := a.codigo;
    -- O endereço que a pessoa escreveu vale (o apartamento, o bloco); senão o do anúncio.
    v_end := coalesce(v_end, app.anuncio_endereco(a.id));
  end if;
  if v_end is null or char_length(v_end) < 3 then
    return jsonb_build_object('ok', false, 'motivo', 'visita_sem_imovel');
  end if;

  v_r := public.visita_marcar(p_organization_id, p_inicio, p_deal_id, p_dono);
  if coalesce((v_r ->> 'ok')::boolean, false) then
    perform app.visita_imovel_gravar((v_r ->> 'task_id')::uuid, a.id, v_codigo, v_end, 'crm', auth.uid());
  end if;
  return v_r;
end $$;
comment on function public.visita_marcar_com_imovel(uuid, timestamptz, uuid, uuid, uuid, text) is
  'Marca a visita na Agenda (Imova) com o imóvel: exige o anúncio (não excluído) ou o endereço escrito, chama public.visita_marcar (as mesmas regras e o mesmo retorno) e grava visita_imoveis (origem crm).';

create or replace function public.visita_definir_imovel(
  p_task_id uuid, p_anuncio_id uuid default null, p_endereco text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  t        public.tasks%rowtype;
  a        public.anuncios%rowtype;
  v_end    text := left(nullif(btrim(regexp_replace(coalesce(app.sem_cpf(p_endereco), ''), '\s+', ' ', 'g')), ''), 500);
  v_codigo text;
  v_nome   text;
begin
  if auth.uid() is null or not app.can_write() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  select * into t from public.tasks where id = p_task_id;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'nao_existe');
  end if;
  -- Quem pode mexer na tarefa (a política `tasks_update`).
  if not (app.is_manager() or t.assignee_id is not distinct from auth.uid()
          or t.created_by is not distinct from auth.uid()) then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if t.kind <> 'visit'::app.task_kind
     and not exists (select 1 from public.visita_imoveis vi where vi.task_id = t.id) then
    return jsonb_build_object('ok', false, 'motivo', 'nao_e_visita');
  end if;
  if p_anuncio_id is not null then
    select * into a from public.anuncios where id = p_anuncio_id;
    if not found or a.excluido_em is not null then
      return jsonb_build_object('ok', false, 'motivo', 'anuncio_invalido');
    end if;
    v_codigo := a.codigo;
    v_end := coalesce(v_end, app.anuncio_endereco(a.id));
  end if;
  if v_end is null or char_length(v_end) < 3 then
    return jsonb_build_object('ok', false, 'motivo', 'visita_sem_imovel');
  end if;

  perform app.visita_imovel_gravar(t.id, a.id, v_codigo, v_end, 'corrigido', auth.uid());

  -- A tarefa "Confirmar o imóvel" cumpriu o papel quando nenhuma visita aberta
  -- da ficha continua sem imóvel.
  if t.organization_id is not null
     and not exists (select 1 from public.tasks v
                      where v.organization_id = t.organization_id and v.kind = 'visit'::app.task_kind
                        and v.status in ('todo'::app.task_status, 'doing'::app.task_status)
                        and not exists (select 1 from public.visita_imoveis vi where vi.task_id = v.id)) then
    select o.name into v_nome from public.organizations o where o.id = t.organization_id;
    update public.tasks x
       set status = 'done'::app.task_status
     where x.organization_id = t.organization_id and x.origin = 'system'
       and x.kind = 'message'::app.task_kind
       and x.status in ('todo'::app.task_status, 'doing'::app.task_status)
       and x.title = left('Confirmar o imóvel da visita com ' || coalesce(nullif(btrim(v_nome), ''), 'o cliente'), 200);
  end if;

  return jsonb_build_object('ok', true, 'codigo', v_codigo, 'endereco', v_end);
end $$;
comment on function public.visita_definir_imovel(uuid, uuid, text) is
  'Grava ou corrige o imóvel de uma visita (Imova; origem corrigido): o anúncio (não excluído) ou o endereço escrito. Quem pode mexer na tarefa. Devolve {ok:true, codigo, endereco} ou {ok:false, motivo: sem_permissao | nao_existe | nao_e_visita | visita_sem_imovel | anuncio_invalido}. Fecha a tarefa "Confirmar o imóvel da visita com ..." quando nenhuma visita aberta da ficha fica sem imóvel.';


-- =====================================================================
-- 7. A IA que ainda marca direto: a visita dela também tem imóvel
-- =====================================================================
-- O corpo é o de 20261106170000; o que mudou está marcado com "11/11/2026".
-- A visita da IA é a reunião presencial no endereço do imóvel (com a tarefa-eco
-- `meeting`); o imóvel vai para `visita_imoveis` pela tarefa-eco, origem 'ia'.
create or replace function public.ia_atendente_marcar_visita(
  p_conversation_id uuid, p_em_resposta_a uuid, p_inicio timestamptz,
  p_imovel_codigo text, p_texto text,
  p_ai_run_id bigint default null, p_prompt_version text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_imovel jsonb;
  v_local  text;
  v_obs    text;
  v_r      jsonb;
  v_disse  jsonb;
  -- 11/11/2026
  v_anuncio uuid;
  v_end     text;
  v_task    uuid;
begin
  if not app.ia_atende(p_conversation_id) then
    return jsonb_build_object('ok', false, 'motivo', 'ia_nao_atende');
  end if;
  select i into v_imovel
    from jsonb_array_elements(app.ia_atendente_imoveis()) i
   where i ->> 'codigo' = p_imovel_codigo
   limit 1;
  v_local := nullif(concat_ws(', ',
               nullif(concat_ws(' ', v_imovel ->> 'rua', v_imovel ->> 'numero'), ''),
               v_imovel ->> 'bairro', v_imovel ->> 'cidade'), '');
  v_local := coalesce(v_local, 'Endereço a confirmar pelo corretor');
  v_obs := left('Visita marcada pela IA' ||
                coalesce(' — imóvel ' || p_imovel_codigo
                         || coalesce(' (' || (v_imovel ->> 'titulo') || ')', ''), ''), 500);

  begin
    v_r := app.reuniao_gravar(p_conversation_id, null, p_inicio, 'presencial', v_local, v_obs, 'robo', null);
    if not coalesce((v_r ->> 'ok')::boolean, false) then
      return v_r;
    end if;
    v_disse := app.ia_atendente_dizer(p_conversation_id, p_em_resposta_a, p_texto, 'marcou_visita',
                                      jsonb_build_object('reuniao', v_r, 'imovel', p_imovel_codigo),
                                      p_ai_run_id, p_prompt_version);
    if not coalesce((v_disse ->> 'ok')::boolean, false) then
      -- A confirmação não saiu: a visita também não fica.
      raise exception using errcode = 'P0001', message = 'ia_visita_desfeita';
    end if;
  exception when sqlstate 'P0001' then
    if sqlerrm = 'ia_visita_desfeita' then
      return v_disse || jsonb_build_object('visita', 'desfeita');
    end if;
    raise;
  end;

  -- 11/11/2026: o imóvel da visita, com o endereço inteiro do anúncio.
  v_anuncio := app.agenda_anuncio_do_codigo(p_imovel_codigo);
  v_end := app.anuncio_endereco(v_anuncio);
  select r.task_id into v_task from public.reunioes r where r.id = (v_r ->> 'reuniao_id')::uuid;
  if v_task is not null and v_end is not null then
    perform app.visita_imovel_gravar(v_task, v_anuncio,
              (select a.codigo from public.anuncios a where a.id = v_anuncio), v_end, 'ia', null);
  end if;
  return v_disse || jsonb_build_object('reuniao', v_r);
end $$;
comment on function public.ia_atendente_marcar_visita(uuid, uuid, timestamptz, text, text, bigint, text) is
  'Porta do worker de IA: marca a visita (app.reuniao_gravar, presencial, no endereço do imóvel quando o anúncio o mostra, origem robô) e manda a confirmação na mesma transação. Se a confirmação não sair, a visita é desfeita. Desde 11/11/2026, o imóvel vai para visita_imoveis (origem ia). O caminho novo da IA é o link da agenda (ia_atendente_enviar_link).';


-- =====================================================================
-- 8. O Calendly com o convite
-- =====================================================================
-- A ficha do convite: a da conversa. Completa só o que falta (o telefone, se
-- ninguém o tem; o e-mail; o responsável), como a ficha ligada de
-- `app.calendly_ficha`. Ficha suprimida devolve ficha = 'suprimida'.
create or replace function app.calendly_ficha_do_convite(
  p_org uuid, p_email text, p_telefone text, p_dono uuid, p_deal uuid,
  out organizacao uuid, out negocio uuid, out ficha text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tel   text := app.normalize_phone_br(p_telefone);
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 254 then
    v_email := null;
  end if;
  if v_tel is not null and app.is_suppressed(v_tel) then
    v_tel := null;
  end if;
  if app.is_suppressed_target(p_org, null) then
    ficha := 'suprimida';
    return;
  end if;

  organizacao := p_org;
  ficha := 'ligada';
  update public.organizations o
     set phone_e164 = case when o.phone_e164 is null and v_tel is not null
                                and not exists (select 1 from public.organizations y
                                                 where y.phone_e164 = v_tel and y.deleted_at is null)
                           then v_tel else o.phone_e164 end,
         email = coalesce(o.email, v_email),
         owner_id = coalesce(o.owner_id, p_dono)
   where o.id = p_org
     and ((o.phone_e164 is null and v_tel is not null) or (o.email is null and v_email is not null)
          or (o.owner_id is null and p_dono is not null));
  negocio := coalesce((select d.id from public.deals d where d.id = p_deal and d.organization_id = p_org),
                      app.wa_negocio_da_ficha(p_org));
  if negocio is not null and p_dono is not null then
    update public.deals d set owner_id = p_dono where d.id = negocio and d.owner_id is null;
  end if;
end $$;

-- O corpo é o de 20261111204000. O que mudou está marcado com "11/11/2026 (convite)".
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
  v_dia      date;
  v_recusa   text;
  v_feriado  text;
  v_marcou   text;
  v_anuncio  uuid;
  v_da_visita record;
  -- 11/11/2026 (convite)
  v_token      text;
  v_cv         public.agenda_convites%rowtype;
  v_cv_estado  text;
  v_conv       public.conversations%rowtype;
  v_org_cv     uuid;
  v_lugar_resp text;
  v_end        text;
  v_tem_imovel boolean := false;
  v_tarefa_imovel uuid;
  v_extra      text := '';
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

    -- 11/11/2026 (convite): o Calendly cancelou (o cliente, a equipe pelo CRM,
    -- ou o CRM pedindo pelo horário recusado): o convite que levou a este
    -- agendamento volta a valer. Na remarcação, não: o horário novo é do mesmo
    -- convidado e continua com o convite.
    if v_situacao = 'cancelado' then
      update public.agenda_convites
         set usado_em = null, calendly_agendamento_id = null
       where calendly_agendamento_id = v_ag.id;
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

  -- 11/11/2026 (convite): o agendamento anterior (remarcação) é lido aqui, antes
  -- do convite; ele fecha mais abaixo, no mesmo lugar de antes.
  if v_ant_uri is not null then
    select * into v_ant from public.calendly_agendamentos where convidado_uri = v_ant_uri;
  end if;

  -- 11/11/2026 (convite): o token do link (`tracking.utm_content`). Vale quando
  -- existe, não venceu e não foi usado; ou quando é do mesmo convidado
  -- remarcando (o convite aponta para o agendamento anterior, e então vale
  -- mesmo vencido e mesmo que o Calendly não mande o token de novo). Inválido,
  -- vencido ou usado por outro: segue como sem convite.
  v_token := lower(nullif(btrim(coalesce(p_evento ->> 'convite', '')), ''));
  if v_token is not null then
    if v_token ~ '^[a-z0-9]{10,16}$' then
      select * into v_cv from public.agenda_convites where token = v_token for update;
    end if;
    v_cv_estado := case when v_cv.id is null then 'inexistente' end;
  end if;
  if v_cv.id is null and v_ant.id is not null then
    select * into v_cv from public.agenda_convites
     where calendly_agendamento_id = v_ant.id
     order by criado_em desc limit 1
     for update;
  end if;
  if v_cv.id is not null then
    v_cv_estado := case
      when v_ant.id is not null and v_cv.calendly_agendamento_id = v_ant.id then 'valido'
      when v_cv.usado_em is not null then 'usado'
      when v_cv.expira_em <= now() then 'expirado'
      else 'valido' end;
    if v_cv_estado <> 'valido' then
      v_cv := null;
    end if;
  end if;
  -- O tipo é o do convite, e não o da resposta.
  if v_cv.id is not null then
    v_natureza := v_cv.tipo;
  end if;

  -- Onde. Visita é sempre presencial; reunião presencial sem endereço fica com
  -- o lugar a combinar (a trava `reunioes_lugar_chk` pede um texto).
  v_local := left(nullif(btrim(coalesce(app.sem_cpf(p_evento ->> 'local'), '')), ''), 500);
  v_link  := case when (p_evento ->> 'link') ~ '^https://' then left(p_evento ->> 'link', 1000) end;
  v_formato := case when v_natureza = 'visita' then 'presencial'
                    when p_evento ->> 'formato' = 'presencial' then 'presencial'
                    else 'online' end;
  -- Na visita, o endereço que o cliente deu (ou o do anúncio cujo código ele
  -- deu) vale por cima do local do evento, que é o da sala on-line ou do
  -- escritório. 11/11/2026 (convite): com o convite, vale o imóvel do convite.
  if v_natureza = 'visita' then
    if v_cv.id is not null then
      v_local   := left(v_cv.endereco || coalesce(' (anúncio ' || v_cv.imovel_codigo || ')', ''), 500);
      v_anuncio := v_cv.anuncio_id;
    else
      select * into v_da_visita from app.calendly_local_da_visita(v_resp);
      v_lugar_resp := v_da_visita.lugar;
      v_local   := coalesce(v_da_visita.lugar, v_local);
      v_anuncio := v_da_visita.anuncio_id;
    end if;
  end if;
  if v_formato = 'presencial' then
    v_link := null;
    v_local := coalesce(v_local, 'Local a combinar (o Calendly não informou)');
  else
    v_local := null;
  end if;

  -- A remarcação: o agendamento velho fecha antes de o novo ocupar o horário
  -- (senão o novo bateria com o velho na conta do conflito).
  if v_ant.id is not null then
    perform app.calendly_fechar(v_ant.id, 'remarcado', null);
    v_reu_ant := v_ant.reuniao_id;
  end if;

  v_dono := app.calendly_dono(p_evento ->> 'anfitriao_email');
  -- 11/11/2026 (convite): a ficha é a da conversa do convite, sem casar e-mail
  -- nem telefone. Sem ficha na conversa (ou ficha apagada), a de sempre.
  if v_cv.id is not null then
    select * into v_conv from public.conversations where id = v_cv.conversation_id;
    v_org_cv := coalesce(v_cv.organization_id, v_conv.organization_id);
    if v_org_cv is not null
       and exists (select 1 from public.organizations o where o.id = v_org_cv and o.deleted_at is null) then
      select f.organizacao, f.negocio, f.ficha into v_org, v_deal, v_ficha
        from app.calendly_ficha_do_convite(v_org_cv, p_evento ->> 'email', p_evento ->> 'telefone',
                                           v_dono, v_conv.deal_id) f;
    end if;
  end if;
  if v_ficha is null then
    -- A ficha e o negócio nascem com quem atende como responsável.
    select f.organizacao, f.negocio, f.ficha into v_org, v_deal, v_ficha
      from app.calendly_ficha(p_evento ->> 'nome', p_evento ->> 'email', p_evento ->> 'telefone', v_dono) f;
  end if;

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
                              'situacao', v_situacao, 'ficha', v_ficha, 'convite', v_cv_estado);
  end if;

  select o.name into v_nome from public.organizations o where o.id = v_org;
  v_titulo := case when v_natureza = 'visita' then 'Visita: ' || coalesce(v_nome, 'cliente')
                   else 'Reunião com ' || coalesce(v_nome, 'cliente') end;

  -- Serializa por (pessoa, dia), como a `reuniao_gravar`: dois agendamentos no
  -- mesmo instante enxergam um ao outro na conta do conflito.
  v_dia := (v_inicio at time zone 'America/Fortaleza')::date;
  perform pg_advisory_xact_lock(hashtextextended(v_dono::text || v_dia::text, 0));

  -- Sábado, domingo e feriado não têm visita nem reunião, como na
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
      -- 11/11/2026 (convite): a reunião fica ligada à conversa do convite.
      insert into public.reunioes (organization_id, deal_id, conversation_id, contact_id, dono_id, titulo,
                                   formato, inicio, fim, link, local, estado, marcada_por, observacao,
                                   remarcada_de)
      values (v_org, v_deal, v_conv.id, v_conv.contact_id, v_dono, v_titulo, v_formato, v_inicio, v_fim,
              v_link, v_local, 'marcada', 'calendly',
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
  -- Recusado: horário ocupado, ou dia que não é útil. Nada entra na agenda; o
  -- Calendly cancela e pede ao cliente outro horário (caminho 3).
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

    -- 11/11/2026 (convite): o convite fica preso a este agendamento até o
    -- Calendly confirmar o cancelamento que o CRM pede; aí volta a valer.
    if v_cv.id is not null then
      update public.agenda_convites set usado_em = now(), calendly_agendamento_id = v_id
       where id = v_cv.id;
    end if;

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
                               'ficha', v_ficha, 'natureza', v_natureza, 'convite_id', v_cv.id));
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
                              'ficha', v_ficha, 'conflitos', jsonb_array_length(v_conf),
                              'convite', v_cv_estado, 'convite_id', v_cv.id);
  end if;

  -- -----------------------------------------------------------------
  -- Horário livre: entra na agenda.
  -- -----------------------------------------------------------------
  insert into public.tasks (title, kind, status, priority, due_at, assignee_id,
                            organization_id, deal_id, contact_id, origin)
  values (v_titulo,
          case when v_natureza = 'visita' then 'visit'::app.task_kind else 'meeting'::app.task_kind end,
          'todo'::app.task_status, 2, v_inicio, v_dono, v_org, v_deal, v_conv.contact_id, 'calendly')
  returning id into v_task;

  -- 11/11/2026: o imóvel da visita. Do convite; sem convite, o da resposta
  -- "Endereço ou código do imóvel" (o anúncio pelo código, ou o endereço
  -- escrito); remarcou, o da visita anterior. Sem nenhum: "Confirmar o imóvel".
  if v_natureza = 'visita' then
    if v_cv.id is not null then
      perform app.visita_imovel_gravar(v_task, v_cv.anuncio_id, v_cv.imovel_codigo, v_cv.endereco, 'convite', null);
      v_tem_imovel := true;
    elsif v_anuncio is not null then
      v_end := app.anuncio_endereco(v_anuncio);
      if v_end is not null then
        perform app.visita_imovel_gravar(v_task, v_anuncio,
                  (select a.codigo from public.anuncios a where a.id = v_anuncio), v_end, 'calendly', null);
        v_tem_imovel := true;
      end if;
    elsif v_lugar_resp is not null then
      perform app.visita_imovel_gravar(v_task, null, null, v_lugar_resp, 'calendly', null);
      v_tem_imovel := true;
    end if;
    if not v_tem_imovel and v_ant.task_id is not null then
      insert into public.visita_imoveis (task_id, anuncio_id, codigo, endereco, origem, atualizado_por)
      select v_task, vi.anuncio_id, vi.codigo, vi.endereco, vi.origem, vi.atualizado_por
        from public.visita_imoveis vi where vi.task_id = v_ant.task_id
      on conflict (task_id) do nothing;
      v_tem_imovel := found;
    end if;
    if not v_tem_imovel then
      v_tarefa_imovel := app.visita_tarefa_confirmar_imovel(v_task);
    end if;
  end if;

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

  -- 11/11/2026 (convite): o convite foi usado, por este agendamento.
  if v_cv.id is not null then
    update public.agenda_convites set usado_em = now(), calendly_agendamento_id = v_id
     where id = v_cv.id;
    v_extra := ' Pelo link que ' || case when v_cv.pela_ia then 'a IA'
                                          else coalesce(app.primeiro_nome(v_cv.criado_por), 'a equipe') end
               || ' mandou na conversa.';
  end if;
  if v_natureza = 'visita' then
    v_extra := v_extra || coalesce(' Imóvel: '
                 || (select concat_ws(' · ', vi.codigo, vi.endereco) from public.visita_imoveis vi
                      where vi.task_id = v_task) || '.',
               ' O cliente não disse o imóvel: ficou a tarefa de confirmar com ele.');
  end if;

  insert into public.activities (type, organization_id, deal_id, user_id, author_kind, body, metadata)
  values ('system', v_org, v_deal, null, 'system',
          left(format('%s pelo cliente no Calendly para %s%s.%s%s',
                      case when v_natureza = 'visita' then 'Visita agendada' else 'Reunião agendada' end,
                      app.avisos_quando(v_inicio, true),
                      coalesce(' (' || v_tipo_ev || ')', ''),
                      v_extra,
                      coalesce(' Respostas: ' || v_resp_txt, '')), 2000),
          jsonb_build_object('origin', 'calendly', 'calendly_agendamento_id', v_id,
                             'situacao', 'agendado', 'ficha', v_ficha, 'natureza', v_natureza,
                             'convite_id', v_cv.id));

  return jsonb_build_object('ok', true, 'duplicado', false, 'agendamento_id', v_id,
                            'situacao', 'agendado', 'natureza', v_natureza, 'ficha', v_ficha,
                            'reuniao_id', v_reuniao, 'task_id', v_task, 'aviso_id', v_aviso,
                            'conflitos', 0, 'convite', v_cv_estado, 'convite_id', v_cv.id,
                            'tarefa_imovel_id', v_tarefa_imovel);
end $$;
comment on function public.calendly_receber(jsonb) is
  'Recebe um aviso do Calendly (só a Edge Function calendly-webhook, com a chave de serviço), já resumido por ela. Idempotente pela URI do convidado. Com o convite do link (p_evento.convite = utm_content, 11/11/2026): a ficha, a conversa, o tipo e o imóvel são os do convite. Agendado em horário livre de dia útil: liga ou cria a ficha (com quem atende como responsável), põe a reunião ou visita na agenda de quem atende, grava o imóvel da visita (visita_imoveis; sem imóvel, a tarefa "Confirmar o imóvel"), avisa (agenda_avisos e push) e anota na ficha. Em horário ocupado, sábado, domingo ou feriado: não entra na agenda (recusado, com motivo_recusa) e o cancelamento fica pendente para o Calendly. Cancelado: tira da agenda, avisa e devolve o convite. Não envia nada pelo WhatsApp.';


-- =====================================================================
-- 9. O {{local}} do lembrete prefere o imóvel da visita
-- =====================================================================
-- O corpo é o de 20261111206000; o que mudou está marcado com "11/11/2026".
create or replace function app.lembrete_visitas_do_periodo(p_de date, p_ate date)
returns table (task_id uuid, reuniao_id uuid, organization_id uuid, contact_id uuid,
               deal_id uuid, conversation_id uuid, responsavel_id uuid,
               marcada_para timestamptz, local text)
language sql
stable
security definer
set search_path = ''
as $$
  -- (a) A tarefa de visita com hora combinada: do Calendly ou marcada no CRM.
  select t.id, null::uuid, t.organization_id, t.contact_id, t.deal_id, null::uuid,
         t.assignee_id, t.due_at,
         coalesce(
           -- 11/11/2026: o imóvel da visita, com o código.
           app.visita_imovel_local(t.id),
           (select nullif(btrim(c.local), '')
              from public.calendly_agendamentos c
             where c.task_id = t.id
               and c.local is not null
               and c.local !~* '^\s*local a combinar'
             order by c.recebido_em desc
             limit 1),
           nullif(btrim(o.address), ''))
    from public.tasks t
    join public.organizations o on o.id = t.organization_id and o.deleted_at is null
   where t.kind = 'visit'::app.task_kind
     and t.status in ('todo'::app.task_status, 'doing'::app.task_status)
     and t.origin in ('manual', 'calendly')
     and t.due_at >= (p_de::timestamp at time zone 'America/Fortaleza')
     and t.due_at <  ((p_ate + 1)::timestamp at time zone 'America/Fortaleza')
     and not exists (select 1 from public.reunioes r where r.task_id = t.id)
  union all
  -- (b) A reunião presencial marcada ou confirmada (a visita que a IA e o
  --     Calendly marcam), pelo eco dela em `tasks`.
  select t.id, r.id, r.organization_id, coalesce(r.contact_id, t.contact_id),
         coalesce(r.deal_id, t.deal_id), r.conversation_id, r.dono_id, r.inicio,
         -- 11/11/2026: a visita da IA tem o imóvel gravado pela tarefa-eco.
         coalesce(app.visita_imovel_local(t.id), nullif(btrim(r.local), ''))
    from public.reunioes r
    join public.tasks t on t.id = r.task_id
    join public.organizations o on o.id = r.organization_id and o.deleted_at is null
   where r.formato = 'presencial'
     and r.estado in ('marcada', 'confirmada')
     and t.status in ('todo'::app.task_status, 'doing'::app.task_status)
     and r.inicio >= (p_de::timestamp at time zone 'America/Fortaleza')
     and r.inicio <  ((p_ate + 1)::timestamp at time zone 'America/Fortaleza')
$$;
comment on function app.lembrete_visitas_do_periodo(date, date) is
  'As visitas que podem receber lembrete entre p_de e p_ate (dias de Natal): tarefa visit aberta com hora combinada (origem calendly ou manual, a régua da Agenda) e reunião presencial marcada ou confirmada (a visita da IA e do Calendly). O local prefere o imóvel da visita (visita_imoveis, desde 11/11/2026). Cancelada, remarcada, feita, a confirmar e on-line ficam de fora.';


-- =====================================================================
-- 10. A LGPD: o que o dossiê lê das duas tabelas
-- =====================================================================
-- Por `to_regclass`: se as tabelas saírem (o "como desfazer"), o dossiê
-- continua de pé, só sem estas duas listas.
create or replace function app.lgpd_agenda_convites(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb := '[]'::jsonb;
begin
  if to_regclass('public.agenda_convites') is null then
    return v;
  end if;
  execute $q$
    select coalesce(jsonb_agg(jsonb_build_object(
             'tipo', ac.tipo, 'imovel', ac.imovel_codigo, 'endereco', ac.endereco,
             'link', ac.link, 'enviado_em', ac.criado_em, 'pela_ia', ac.pela_ia,
             'expira_em', ac.expira_em, 'usado_em', ac.usado_em) order by ac.criado_em), '[]'::jsonb)
      from public.agenda_convites ac
     where ac.organization_id = $1
        or ac.conversation_id in (select c.id from public.conversations c where c.organization_id = $1)
  $q$ into v using p_organization_id;
  return v;
end $$;

create or replace function app.lgpd_visita_imoveis(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb := '[]'::jsonb;
begin
  if to_regclass('public.visita_imoveis') is null then
    return v;
  end if;
  execute $q$
    select coalesce(jsonb_agg(jsonb_build_object(
             'visita', t.title, 'quando', t.due_at, 'imovel', vi.codigo, 'endereco', vi.endereco,
             'origem', vi.origem) order by t.due_at), '[]'::jsonb)
      from public.visita_imoveis vi
      join public.tasks t on t.id = vi.task_id
     where t.organization_id = $1
  $q$ into v using p_organization_id;
  return v;
end $$;


-- =====================================================================
-- 11. Quem chama o quê
-- =====================================================================
revoke all on function app.url_codificar(text) from public, anon, authenticated;
revoke all on function app.agenda_token_novo() from public, anon, authenticated;
revoke all on function app.anuncio_endereco(uuid) from public, anon, authenticated;
revoke all on function app.agenda_anuncio_do_codigo(text) from public, anon, authenticated;
revoke all on function app.agenda_link_base(jsonb, text) from public, anon, authenticated;
revoke all on function app.agenda_link_montar(jsonb, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function app.agenda_sem_link(text) from public, anon, authenticated;
revoke all on function app.agenda_texto_do_link(text, text, text, text) from public, anon, authenticated;
revoke all on function app.agenda_ve_conversa(uuid) from public, anon, authenticated;
revoke all on function app.agenda_convite_preparar(uuid, text, uuid, text, text) from public, anon, authenticated;
revoke all on function app.ia_convites_da_agenda(uuid) from public, anon, authenticated;
revoke all on function app.visita_imovel_gravar(uuid, uuid, text, text, text, uuid) from public, anon, authenticated;
revoke all on function app.visita_imovel_local(uuid) from public, anon, authenticated;
revoke all on function app.visita_tarefa_confirmar_imovel(uuid) from public, anon, authenticated;
revoke all on function app.calendly_ficha_do_convite(uuid, text, text, uuid, uuid) from public, anon, authenticated;
revoke all on function app.lgpd_agenda_convites(uuid) from public, anon, authenticated;
revoke all on function app.lgpd_visita_imoveis(uuid) from public, anon, authenticated;
revoke all on function app.calendly_config() from public, anon, authenticated;
revoke all on function app.lembrete_visitas_do_periodo(date, date) from public, anon, authenticated;

revoke all on function public.calendly_link_configurar(text) from public, anon, service_role;
revoke all on function public.agenda_link_previa(uuid, text, uuid, text) from public, anon, service_role;
revoke all on function public.agenda_enviar_link(uuid, text, uuid, text) from public, anon, service_role;
revoke all on function public.visita_marcar_com_imovel(uuid, timestamptz, uuid, uuid, uuid, text) from public, anon, service_role;
revoke all on function public.visita_definir_imovel(uuid, uuid, text) from public, anon, service_role;
grant execute on function public.calendly_link_configurar(text) to authenticated;
grant execute on function public.agenda_link_previa(uuid, text, uuid, text) to authenticated;
grant execute on function public.agenda_enviar_link(uuid, text, uuid, text) to authenticated;
grant execute on function public.visita_marcar_com_imovel(uuid, timestamptz, uuid, uuid, uuid, text) to authenticated;
grant execute on function public.visita_definir_imovel(uuid, uuid, text) to authenticated;

revoke all on function public.ia_atendente_enviar_link(uuid, uuid, text, text, text, bigint, text) from public, anon, authenticated;
grant execute on function public.ia_atendente_enviar_link(uuid, uuid, text, text, text, bigint, text) to service_role;
revoke all on function public.ia_atendente_marcar_visita(uuid, uuid, timestamptz, text, text, bigint, text) from public, anon, authenticated;
grant execute on function public.ia_atendente_marcar_visita(uuid, uuid, timestamptz, text, text, bigint, text) to service_role;
revoke all on function public.calendly_receber(jsonb) from public, anon, authenticated;
grant execute on function public.calendly_receber(jsonb) to service_role;

  $ddl$;

  -- ===================================================================
  -- 12. Trocas sobre a definição que está no banco (um trecho, uma âncora)
  -- ===================================================================
  -- (a) A IA aceita a ação nova (`app.ia_atendente_dizer`, 20261106170000).
  v_def := pg_get_functiondef('app.ia_atendente_dizer(uuid, uuid, text, text, jsonb, bigint, text)'::regprocedure);
  if position('''enviou_link''' in v_def) = 0 then
    v_ancora := $a$if p_acao not in ('respondeu', 'passou_para_pessoa', 'marcou_visita', 'anotou') then$a$;
    v_vezes := (length(v_def) - length(replace(v_def, v_ancora, ''))) / length(v_ancora);
    if v_vezes <> 1 then
      raise exception 'app.ia_atendente_dizer não tem a lista de ações exatamente uma vez (achei %): nada foi trocado.', v_vezes;
    end if;
    execute replace(v_def, v_ancora,
      $a$if p_acao not in ('respondeu', 'passou_para_pessoa', 'marcou_visita', 'anotou', 'enviou_link') then$a$);
  end if;

  -- (b) A entrada da IA ganha `convites_da_agenda` (`public.ia_entrada_do_atendente`).
  v_def := pg_get_functiondef('public.ia_entrada_do_atendente(uuid)'::regprocedure);
  if position('convites_da_agenda' in v_def) = 0 then
    v_ancora := $a$'mensagens', v_msgs);$a$;
    v_vezes := (length(v_def) - length(replace(v_def, v_ancora, ''))) / length(v_ancora);
    if v_vezes <> 1 then
      raise exception 'public.ia_entrada_do_atendente não termina em ''mensagens'', v_msgs) exatamente uma vez (achei %): nada foi trocado.', v_vezes;
    end if;
    execute replace(v_def, v_ancora,
      $a$'mensagens', v_msgs,
    -- O convite da Agenda (20261112160000): os 5 mais novos, para a IA não
    -- mandar o mesmo link de novo e saber se o cliente já agendou.
    'convites_da_agenda', app.ia_convites_da_agenda(c.id));$a$);
    comment on function public.ia_entrada_do_atendente(uuid) is
      'Porta do worker de IA: o que a IA que atende lê de uma conversa (Imova): as 40 mensagens mais recentes, o cliente (ficha, etapa, perfil, visitas, canal de chegada), os horários livres de visita, se é a conversa do treino e (desde 11/11/2026) convites_da_agenda, os 5 links da agenda mais novos da conversa: tipo, imovel_codigo, enviado_em e agendado.';
  end if;

  -- (c) O dossiê da LGPD (`app.lgpd_dossie`): os convites e os imóveis das visitas.
  v_def := pg_get_functiondef('app.lgpd_dossie(uuid)'::regprocedure);
  if position('app.lgpd_agenda_convites' in v_def) = 0 then
    v_ancora := $a$'retencao', $a$;
    v_vezes := (length(v_def) - length(replace(v_def, v_ancora, ''))) / length(v_ancora);
    if v_vezes <> 1 then
      raise exception 'app.lgpd_dossie não tem a chave ''retencao'' exatamente uma vez (achei %): nada foi trocado.', v_vezes;
    end if;
    execute replace(v_def, v_ancora,
      $a$-- A agenda da Imova (20261112160000): os links do Calendly mandados ao
    -- titular e o imóvel das visitas dele.
    'convites_da_agenda', app.lgpd_agenda_convites(o.id),
    'imoveis_das_visitas', app.lgpd_visita_imoveis(o.id),
    'retencao', $a$);
  end if;

  -- (d) A retenção (`app.aplicar_retencao`): o convite e o endereço escrito.
  v_def := pg_get_functiondef('app.aplicar_retencao()'::regprocedure);
  if position('agenda_convites' in v_def) = 0 then
    v_ancora := $a$  insert into public.retention_runs (report) values (v);$a$;
    v_vezes := (length(v_def) - length(replace(v_def, v_ancora, ''))) / length(v_ancora);
    if v_vezes <> 1 then
      raise exception 'app.aplicar_retencao não grava retention_runs exatamente uma vez (achei %): nada foi trocado.', v_vezes;
    end if;
    v_trecho := $a$  -- (17) A agenda da Imova (20261112160000). O link do convite leva o nome e o
  --      telefone do cliente: 90 dias depois de vencer, fica só a base do link
  --      (o resto da linha é a contagem de convites e de visitas). Ficha
  --      anonimizada perde os convites. E o endereço escrito à mão (o imóvel sem
  --      anúncio, que pode ser a casa do proprietário) sai 12 meses depois da
  --      visita; o do anúncio fica, porque não é dado de ninguém.
  if to_regclass('public.agenda_convites') is not null then
    execute $r$
      update public.agenda_convites
         set link = split_part(link, '?', 1)
       where expira_em < now() - interval '90 days' and position('?' in link) > 0
    $r$;
    get diagnostics n = row_count; v := v || jsonb_build_object('agenda_convites_links', n);
    execute $r$
      delete from public.agenda_convites ac
       using public.organizations o
       where o.id = ac.organization_id and o.anonymized_at is not null
    $r$;
    get diagnostics n = row_count; v := v || jsonb_build_object('agenda_convites_anonimizados', n);
  end if;
  if to_regclass('public.visita_imoveis') is not null then
    execute $r$
      delete from public.visita_imoveis vi
       using public.tasks t
       where t.id = vi.task_id and vi.anuncio_id is null
         and coalesce(t.due_at, t.created_at) < now() - interval '12 months'
    $r$;
    get diagnostics n = row_count; v := v || jsonb_build_object('visita_imoveis_enderecos', n);
  end if;

$a$;
    execute replace(v_def, v_ancora, v_trecho || v_ancora);
  end if;

  -- ===================================================================
  -- 13. As visitas que já existem (só as futuras e abertas)
  -- ===================================================================
  -- (a) A do Calendly com o anúncio que o cliente deu pelo código: o
  --     `anuncio_id` do agendamento, ou as respostas guardadas lidas de novo
  --     (o agendamento de antes de 20261111204000 não tinha a coluna).
  insert into public.visita_imoveis (task_id, anuncio_id, codigo, endereco, origem)
  select t.id, a.id, a.codigo, app.anuncio_endereco(a.id), 'calendly'
    from public.tasks t
    cross join lateral (select coalesce(ca.anuncio_id, (app.calendly_local_da_visita(ca.respostas)).anuncio_id)
                                 as anuncio_id
                          from public.calendly_agendamentos ca
                         where ca.task_id = t.id
                         order by ca.recebido_em desc limit 1) c
    join public.anuncios a on a.id = c.anuncio_id and a.excluido_em is null
   where t.kind = 'visit'::app.task_kind
     and t.status in ('todo'::app.task_status, 'doing'::app.task_status)
     and t.due_at > now()
     and app.anuncio_endereco(a.id) is not null
  on conflict (task_id) do nothing;
  get diagnostics v_n = row_count;
  raise notice 'O convite da Agenda: % visita(s) do Calendly ganharam o imóvel do anúncio.', v_n;

  -- (b) A do Calendly com o endereço que o cliente escreveu, sem anúncio. Lido
  --     das respostas, e não do `local` (que pode ser o do evento: o escritório).
  insert into public.visita_imoveis (task_id, anuncio_id, codigo, endereco, origem)
  select t.id, null, null, left(btrim(c.lugar), 500), 'calendly'
    from public.tasks t
    cross join lateral (select x.lugar, x.anuncio_id
                          from public.calendly_agendamentos ca
                          cross join lateral app.calendly_local_da_visita(ca.respostas) x
                         where ca.task_id = t.id
                         order by ca.recebido_em desc limit 1) c
   where t.kind = 'visit'::app.task_kind
     and t.status in ('todo'::app.task_status, 'doing'::app.task_status)
     and t.due_at > now()
     and c.anuncio_id is null and char_length(btrim(coalesce(c.lugar, ''))) >= 3
  on conflict (task_id) do nothing;
  get diagnostics v_n = row_count;
  raise notice 'O convite da Agenda: % visita(s) do Calendly ganharam o endereço que o cliente escreveu.', v_n;

  -- (c) A marcada no CRM com o código do anúncio no título.
  insert into public.visita_imoveis (task_id, anuncio_id, codigo, endereco, origem)
  select t.id, x.anuncio_id, x.codigo, x.endereco, 'crm'
    from public.tasks t
    cross join lateral app.calendly_codigo_do_anuncio(t.title) x
   where t.kind = 'visit'::app.task_kind
     and t.status in ('todo'::app.task_status, 'doing'::app.task_status)
     and t.due_at > now()
     and x.anuncio_id is not null and x.endereco is not null
  on conflict (task_id) do nothing;
  get diagnostics v_n = row_count;
  raise notice 'O convite da Agenda: % visita(s) do CRM ganharam o imóvel pelo código no título.', v_n;

  -- (d) A marcada pela IA (reunião presencial do robô, pela tarefa-eco), com o
  --     código no título, no local ou na observação ("Visita marcada pela IA —
  --     imóvel IM0003").
  insert into public.visita_imoveis (task_id, anuncio_id, codigo, endereco, origem)
  select t.id, x.anuncio_id, x.codigo, x.endereco, 'ia'
    from public.reunioes r
    join public.tasks t on t.id = r.task_id
    cross join lateral app.calendly_codigo_do_anuncio(
                 concat_ws(' ', t.title, r.local, r.observacao)) x
   where r.marcada_por = 'robo' and r.formato = 'presencial'
     and r.estado in ('a_confirmar', 'marcada', 'confirmada')
     and t.status in ('todo'::app.task_status, 'doing'::app.task_status)
     and r.inicio > now()
     and x.anuncio_id is not null and x.endereco is not null
  on conflict (task_id) do nothing;
  get diagnostics v_n = row_count;
  raise notice 'O convite da Agenda: % visita(s) da IA ganharam o imóvel pelo código.', v_n;
end $convite$;

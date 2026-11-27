-- =====================================================================
-- A IA aprende com as respostas de vocês (Imova, 27/11/2026)
-- =====================================================================
-- O aviso de decisão (20261125200000) faz a IA perguntar aos admins o que
-- ela não sabe, e a resposta vai ao cliente. Só que a resposta valia para
-- aquela conversa e se perdia: o próximo cliente que perguntasse a mesma
-- coisa esperava de novo (o FGTS do terreno de Camurupim foi perguntado duas
-- vezes em 26/11).
--
-- Agora, quando um admin responde uma PERGUNTA (não uma proposta de preço),
-- o worker de IA escreve a nota que guardaria essa resposta no caderno
-- (`nota-da-resposta@v1`) e a deixa aqui, sugerida. Ninguém escreve no
-- caderno sem clique: o admin que respondeu vê o cartão "Guardar para os
-- próximos clientes?" logo depois da resposta, e qualquer gestor vê as
-- sugeridas na aba Caderno. Guardar, Editar (o texto) ou Agora não.
--
-- ONDE A NOTA ENTRA: "vale para este imóvel" vai para a FICHA dele no
-- caderno, como o próximo item ("(h) ... (equipe, 26/11)."); sem ficha, nasce
-- uma ficha nova. "Vale para todos" vai para a nota marcada como geral (a 8,
-- marcada à mão depois da publicação); sem ela, nasce uma nota geral. A ficha
-- de cada imóvel é achada por `ia_caderno.anuncio_ids` (novo), e a nota geral
-- por `ia_caderno.papel = 'geral'` (novo). Nota que passaria de 2.000 letras
-- ganha uma continuação.
--
-- A TRAVA (`app.ia_nota_problema`): nenhum trecho sem letra com 10 ou mais
-- algarismos (é o que a IA lê como telefone: a FICHA 4 travou a IA em 19/11
-- por "1.338,99, 2.021"), nem arroba, link, código de anúncio ou marcador de
-- nome. A tela repete a mesma regra para avisar antes do clique.
--
-- Na KOMUNE não faz nada.
--
-- COMO DESFAZER: voltar o worker (sem ele, ninguém sugere); drop do gatilho
-- `ia_decisoes_sugerir_nota`, das funções `public.ia_nota_*`,
-- `public.ia_notas_sugeridas_abertas`, `app.ia_nota_*` e da tabela
-- `public.ia_notas_sugeridas`; as colunas `anuncio_ids` e `papel` do caderno
-- podem ficar (ninguém mais as lê). A restrição da origem só volta a
-- ('treino', 'correcao', 'tela') depois de tirar as notas de origem
-- 'resposta'.
-- =====================================================================

do $imova$
begin
  if (select i.empresa from app.identidade i) = 'komune' then
    raise notice 'A IA que aprende com as respostas é da Imova: nada muda no banco da KOMUNE.';
    return;
  end if;

  -- -------------------------------------------------------------------
  -- 1. O caderno: a origem nova e o endereço de cada nota
  -- -------------------------------------------------------------------
  execute $ddl$
alter table public.ia_caderno drop constraint if exists ia_caderno_origem_check;
alter table public.ia_caderno add constraint ia_caderno_origem_check
  check (origem in ('treino', 'correcao', 'tela', 'resposta'));
alter table public.ia_caderno add column if not exists anuncio_ids uuid[];
alter table public.ia_caderno add column if not exists papel text;
alter table public.ia_caderno drop constraint if exists ia_caderno_papel_check;
alter table public.ia_caderno add constraint ia_caderno_papel_check
  check (papel is null or papel in ('ficha', 'geral'));
comment on column public.ia_caderno.anuncio_ids is
  'De quais anúncios esta nota é a FICHA (27/11/2026): é onde a resposta guardada com "vale para este imóvel" entra.';
comment on column public.ia_caderno.papel is
  'ficha: a ficha de um ou mais imóveis (anuncio_ids). geral: a nota dos fatos que valem para todos os imóveis, onde entra a resposta guardada com "vale para todos" (27/11/2026).';
  $ddl$;

  -- -------------------------------------------------------------------
  -- 2. As notas sugeridas
  -- -------------------------------------------------------------------
  execute $ddl$
create table if not exists public.ia_notas_sugeridas (
  id              uuid primary key default gen_random_uuid(),
  decisao_id      uuid not null unique references public.ia_decisoes (id) on delete cascade,
  conversation_id uuid references public.conversations (id) on delete set null,
  anuncio_id      uuid references public.anuncios (id) on delete set null,
  -- O que o cliente perguntou e o que a Imova respondeu (o texto do admin).
  pergunta        text not null check (char_length(pergunta) between 1 and 300),
  resposta        text not null check (char_length(resposta) between 1 and 600),
  -- A nota como a IA escreveu, para cada alcance; a que não serve fica nula.
  texto_imovel    text check (texto_imovel is null or char_length(texto_imovel) between 10 and 300),
  texto_geral     text check (texto_geral is null or char_length(texto_geral) between 10 and 300),
  escopo_sugerido text not null check (escopo_sugerido in ('imovel', 'geral')),
  -- O nome da ficha nova, quando o imóvel ainda não tem ficha.
  titulo_da_ficha text check (titulo_da_ficha is null or char_length(titulo_da_ficha) between 3 and 120),
  -- Quem respondeu o aviso: é para essa pessoa que o cartão aparece logo depois.
  respondida_por  uuid references public.profiles (id) on delete set null,
  situacao        text not null default 'sugerida'
                    check (situacao in ('sugerida', 'guardada', 'descartada')),
  escopo          text check (escopo is null or escopo in ('imovel', 'geral')),
  texto_guardado  text check (texto_guardado is null or char_length(texto_guardado) between 10 and 300),
  caderno_id      bigint references public.ia_caderno (id) on delete set null,
  decidido_por    uuid references public.profiles (id) on delete set null,
  decidido_em     timestamptz,
  ai_run_id       bigint,
  prompt_version  text,
  criado_em       timestamptz not null default now(),
  constraint ia_notas_sugeridas_tem_texto check (texto_imovel is not null or texto_geral is not null),
  constraint ia_notas_sugeridas_escopo_tem_texto check (
    (escopo_sugerido = 'imovel' and texto_imovel is not null)
    or (escopo_sugerido = 'geral' and texto_geral is not null))
);
create index if not exists ia_notas_sugeridas_abertas_idx
  on public.ia_notas_sugeridas (criado_em) where situacao = 'sugerida';

comment on table public.ia_notas_sugeridas is
  'A IA aprende com as respostas (Imova, 27/11/2026): a nota que guardaria no caderno a resposta que um admin deu no aviso de decisão. Só entra no caderno com o clique de um gestor (public.ia_nota_guardar). Gravado só pelas funções.';

alter table public.ia_notas_sugeridas enable row level security;
drop policy if exists ia_notas_sugeridas_select on public.ia_notas_sugeridas;
create policy ia_notas_sugeridas_select on public.ia_notas_sugeridas
  for select to authenticated using ((select app.is_manager()));
revoke all on public.ia_notas_sugeridas from anon, authenticated, service_role;
grant select on public.ia_notas_sugeridas to authenticated, service_role;

drop trigger if exists audit_ia_notas_sugeridas on public.ia_notas_sugeridas;
create trigger audit_ia_notas_sugeridas after insert or update or delete on public.ia_notas_sugeridas
  for each row execute function app.audit();
  $ddl$;

  -- -------------------------------------------------------------------
  -- 3. As peças: a trava, o título, a letra e o item
  -- -------------------------------------------------------------------
  execute $ddl$
create or replace function app.ia_nota_limpa(p_texto text) returns text
language sql
immutable
set search_path = ''
as $$
  select btrim(regexp_replace(coalesce(p_texto, ''), '\s+', ' ', 'g'))
$$;
revoke all on function app.ia_nota_limpa(text) from public, anon, authenticated;

-- Por que a nota não pode entrar (nulo = pode). A mesma regra está na tela
-- (components/ia-que-atende/notas-sugeridas.ts).
create or replace function app.ia_nota_problema(p_texto text) returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v       text := app.ia_nota_limpa(p_texto);
  v_parte text;
begin
  if char_length(v) < 10 then
    return 'curta';
  end if;
  if char_length(v) > 300 then
    return 'longa';
  end if;
  if position('@' in v) > 0 then
    return 'arroba';
  end if;
  if v ~* '(https?://|www\.)' then
    return 'link';
  end if;
  if v ~ '\[\[[A-Z]+_[0-9]+\]\]' then
    return 'marcador';
  end if;
  if v ~ '(^|[^A-Za-z0-9])[A-Z]{2}[0-9]{3,4}(_IMOVA)?([^0-9]|$)' then
    return 'codigo';
  end if;
  -- O que a IA lê como telefone: 10 ou mais algarismos sem uma letra no meio.
  foreach v_parte in array regexp_split_to_array(v, '[A-Za-zÀ-ÖØ-öø-ÿ]+') loop
    if char_length(regexp_replace(v_parte, '[^0-9]', '', 'g')) >= 10 then
      return 'telefone';
    end if;
  end loop;
  return null;
end $$;
revoke all on function app.ia_nota_problema(text) from public, anon, authenticated;

-- "FICHA 5. TERRENO FRENTE-MAR EM TABATINGA E CAMURUPIM, NÍSIA FLORESTA": o que
-- vem antes dos dois-pontos.
create or replace function app.ia_nota_titulo(p_texto text) returns text
language sql
immutable
set search_path = ''
as $$
  select left(btrim(split_part(coalesce(p_texto, ''), ':', 1)), 120)
$$;
revoke all on function app.ia_nota_titulo(text) from public, anon, authenticated;

-- A próxima letra dos itens da nota: depois de "(g)", "(h)"; sem itens, "(a)";
-- depois de "(z)", sem letra.
create or replace function app.ia_nota_proxima_letra(p_texto text) returns text
language sql
immutable
set search_path = ''
as $$
  select case
           when max(m[1]) is null then 'a'
           when max(m[1]) >= 'z' then null
           else chr(ascii(max(m[1])) + 1)
         end
    from regexp_matches(coalesce(p_texto, ''), '\(([a-z])\)', 'g') as m
$$;
revoke all on function app.ia_nota_proxima_letra(text) from public, anon, authenticated;

-- "(h) FGTS: não dá para usar o FGTS na compra deste terreno (equipe, 26/11)."
create or replace function app.ia_nota_item(p_letra text, p_texto text, p_quando timestamptz)
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce('(' || p_letra || ') ', '')
         || regexp_replace(app.ia_nota_limpa(p_texto), '[.;!]+$', '')
         || ' (equipe, ' || to_char(coalesce(p_quando, now()) at time zone 'America/Fortaleza', 'DD/MM') || ').'
$$;
revoke all on function app.ia_nota_item(text, text, timestamptz) from public, anon, authenticated;

-- O nome da ficha nova quando a IA não deu um: "SALA COMERCIAL DE 19 M² EM PONTA NEGRA, NATAL".
create or replace function app.ia_nota_titulo_do_anuncio(p_anuncio uuid) returns text
language sql
stable
security definer
set search_path = ''
as $$
  select left(upper(btrim(
           case a.tipo::text
             when 'terreno' then 'terreno'
             when 'casa' then 'casa'
             when 'apartamento' then 'apartamento'
             when 'sala_comercial' then 'sala comercial'
             when 'loja' then 'loja'
             else 'imóvel'
           end
           || coalesce(' de ' || replace(to_char(coalesce(a.area_total, a.area_util), 'FM999,999,999'), ',', '.') || ' m²', '')
           || coalesce(' em ' || nullif(btrim(a.bairro), ''), '')
           || coalesce(', ' || nullif(btrim(a.cidade), ''), ''))), 120)
    from public.anuncios a where a.id = p_anuncio
$$;
revoke all on function app.ia_nota_titulo_do_anuncio(uuid) from public, anon, authenticated;

-- A nota onde a resposta entraria: a ficha do imóvel ou a nota geral (a mais
-- nova, que é a continuação quando houver).
create or replace function app.ia_nota_alvo(p_escopo text, p_anuncio uuid) returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select c.id
    from public.ia_caderno c
   where c.ativo
     and ((p_escopo = 'imovel' and c.papel = 'ficha' and p_anuncio is not null
           and p_anuncio = any (coalesce(c.anuncio_ids, '{}'::uuid[])))
          or (p_escopo = 'geral' and c.papel = 'geral'))
   order by c.id desc
   limit 1
$$;
revoke all on function app.ia_nota_alvo(text, uuid) from public, anon, authenticated;
  $ddl$;

  -- -------------------------------------------------------------------
  -- 4. A fila: resposta a uma pergunta vira trabalho do worker
  -- -------------------------------------------------------------------
  execute $ddl$
create or replace function app.ia_nota_enfileirar() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.tipo = 'pergunta' and new.situacao = 'respondida'
     and old.situacao is distinct from 'respondida'
     and nullif(btrim(coalesce(new.texto_decidido, '')), '') is not null then
    -- A sugestão nunca pode atrapalhar a resposta ao cliente.
    begin
      perform app.esteira_enfileirar(
        'ai_jobs',
        jsonb_build_object('purpose', 'sugerir_nota', 'chave', 'sugerir_nota:' || new.id,
                           'decisao_id', new.id),
        'sugerir_nota:' || new.id);
    exception when others then
      raise warning 'ia_nota_enfileirar: %', sqlerrm;
    end;
  end if;
  return null;
end $$;
revoke all on function app.ia_nota_enfileirar() from public, anon, authenticated;

drop trigger if exists ia_decisoes_sugerir_nota on public.ia_decisoes;
create trigger ia_decisoes_sugerir_nota after update of situacao on public.ia_decisoes
  for each row execute function app.ia_nota_enfileirar();
  $ddl$;

  -- -------------------------------------------------------------------
  -- 5. A porta do worker: o que ele lê e por onde devolve
  -- -------------------------------------------------------------------
  execute $ddl$
create or replace function public.ia_nota_entrada(p_decisao_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select jsonb_build_object(
             'existe', true,
             'tipo', d.tipo,
             'situacao', d.situacao,
             'escolha', d.escolha,
             'conversation_id', d.conversation_id,
             'organization_id', d.organization_id,
             'contact_id', c.contact_id,
             'nome', c.peer_nome,
             'pergunta', d.pergunta,
             'resposta', d.texto_decidido,
             'ja_sugerida', exists (select 1 from public.ia_notas_sugeridas s where s.decisao_id = d.id),
             'tem_ficha', app.ia_nota_alvo('imovel', d.anuncio_id) is not null,
             'imovel', case when a.id is null then null else jsonb_build_object(
                         'frase', app.visita_pedido_imovel(a.id),
                         'tipo', a.tipo,
                         'titulo', a.titulo,
                         'area', coalesce(a.area_total, a.area_util),
                         'bairro', a.bairro,
                         'cidade', a.cidade,
                         'negocio', a.negocio) end)
      from public.ia_decisoes d
      left join public.conversations c on c.id = d.conversation_id
      left join public.anuncios a on a.id = d.anuncio_id
     where d.id = p_decisao_id), jsonb_build_object('existe', false))
$$;
comment on function public.ia_nota_entrada(uuid) is
  'Porta do worker de IA (Imova, 27/11/2026): o que a IA lê para escrever a nota que guardaria no caderno a resposta de um admin a uma pergunta do aviso de decisão.';
revoke all on function public.ia_nota_entrada(uuid) from public, anon, authenticated;
grant execute on function public.ia_nota_entrada(uuid) to service_role;

create or replace function public.ia_nota_sugerir(
  p_decisao_id uuid, p_texto_imovel text, p_texto_geral text, p_escopo text,
  p_titulo_da_ficha text default null, p_ai_run_id bigint default null,
  p_prompt_version text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  d        public.ia_decisoes%rowtype;
  v_imovel text := nullif(app.ia_nota_limpa(p_texto_imovel), '');
  v_geral  text := nullif(app.ia_nota_limpa(p_texto_geral), '');
  v_titulo text := nullif(upper(app.ia_nota_limpa(p_titulo_da_ficha)), '');
  v_escopo text := p_escopo;
  v_id     uuid;
begin
  select * into d from public.ia_decisoes where id = p_decisao_id;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'nao_existe');
  end if;
  if d.tipo <> 'pergunta' or d.situacao <> 'respondida'
     or nullif(btrim(coalesce(d.texto_decidido, '')), '') is null then
    return jsonb_build_object('ok', false, 'motivo', 'nao_e_pergunta_respondida');
  end if;
  if exists (select 1 from public.ia_notas_sugeridas s where s.decisao_id = d.id) then
    return jsonb_build_object('ok', false, 'motivo', 'ja_sugerida');
  end if;
  -- Sem imóvel na decisão não há ficha; texto com problema não é sugerido.
  if d.anuncio_id is null or app.ia_nota_problema(v_imovel) is not null then
    v_imovel := null;
  end if;
  if app.ia_nota_problema(v_geral) is not null then
    v_geral := null;
  end if;
  if v_imovel is null and v_geral is null then
    return jsonb_build_object('ok', false, 'motivo', 'sem_texto_valido');
  end if;
  if v_escopo is distinct from 'geral' then
    v_escopo := 'imovel';
  end if;
  if v_escopo = 'imovel' and v_imovel is null then
    v_escopo := 'geral';
  elsif v_escopo = 'geral' and v_geral is null then
    v_escopo := 'imovel';
  end if;
  if v_titulo is not null and (char_length(v_titulo) > 120 or char_length(v_titulo) < 3
                               or (char_length(v_titulo) >= 10 and app.ia_nota_problema(v_titulo) is not null)
                               or position(':' in v_titulo) > 0) then
    v_titulo := null;
  end if;

  insert into public.ia_notas_sugeridas
    (decisao_id, conversation_id, anuncio_id, pergunta, resposta, texto_imovel, texto_geral,
     escopo_sugerido, titulo_da_ficha, respondida_por, ai_run_id, prompt_version)
  values
    (d.id, d.conversation_id, d.anuncio_id, d.pergunta, left(btrim(d.texto_decidido), 600),
     v_imovel, v_geral, v_escopo, v_titulo, d.decidido_por, p_ai_run_id, left(p_prompt_version, 80))
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'escopo', v_escopo);
end $$;
comment on function public.ia_nota_sugerir(uuid, text, text, text, text, bigint, text) is
  'Porta do worker de IA (Imova, 27/11/2026): deixa sugerida a nota que guardaria no caderno a resposta de um admin a uma pergunta. Texto com problema (app.ia_nota_problema) não entra; uma sugestão por decisão.';
revoke all on function public.ia_nota_sugerir(uuid, text, text, text, text, bigint, text) from public, anon, authenticated;
grant execute on function public.ia_nota_sugerir(uuid, text, text, text, text, bigint, text) to service_role;
  $ddl$;

  -- -------------------------------------------------------------------
  -- 6. A tela: as sugeridas, Guardar e Agora não
  -- -------------------------------------------------------------------
  execute $ddl$
create or replace function public.ia_notas_sugeridas_abertas()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not app.is_manager() then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', s.id,
             'decisao_id', s.decisao_id,
             'conversation_id', s.conversation_id,
             'organization_id', d.organization_id,
             'pergunta', s.pergunta,
             'resposta', s.resposta,
             'texto_imovel', s.texto_imovel,
             'texto_geral', s.texto_geral,
             'escopo_sugerido', s.escopo_sugerido,
             'imovel', app.visita_pedido_imovel(s.anuncio_id),
             'codigo', a.codigo,
             'onde_imovel', case when s.anuncio_id is null then null
                                 else coalesce((select app.ia_nota_titulo(c.texto) from public.ia_caderno c
                                                 where c.id = app.ia_nota_alvo('imovel', s.anuncio_id)),
                                               coalesce(s.titulo_da_ficha, app.ia_nota_titulo_do_anuncio(s.anuncio_id))) end,
             'ficha_nova', s.anuncio_id is not null and app.ia_nota_alvo('imovel', s.anuncio_id) is null,
             'onde_geral', (select app.ia_nota_titulo(c.texto) from public.ia_caderno c
                             where c.id = app.ia_nota_alvo('geral', null)),
             'respondida_por', (select t.full_name from public.team_directory t where t.id = s.respondida_por),
             'respondida_por_mim', s.respondida_por = auth.uid(),
             'respondida_em', d.decidido_em,
             'criado_em', s.criado_em)
           order by s.criado_em desc)
      from public.ia_notas_sugeridas s
      join public.ia_decisoes d on d.id = s.decisao_id
      left join public.anuncios a on a.id = s.anuncio_id
     where s.situacao = 'sugerida'
       and s.criado_em > now() - interval '30 days'), '[]'::jsonb);
end $$;
comment on function public.ia_notas_sugeridas_abertas() is
  'As notas que a IA sugeriu guardar no caderno a partir das respostas dos admins e que ninguém guardou nem dispensou (Imova, 27/11/2026), dos últimos 30 dias. Só para gestão.';
revoke all on function public.ia_notas_sugeridas_abertas() from public, anon;
grant execute on function public.ia_notas_sugeridas_abertas() to authenticated;

create or replace function public.ia_nota_guardar(p_id uuid, p_escopo text, p_texto text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  s          public.ia_notas_sugeridas%rowtype;
  d          public.ia_decisoes%rowtype;
  k          public.ia_caderno%rowtype;
  v_eu       uuid := auth.uid();
  v_texto    text := nullif(app.ia_nota_limpa(p_texto), '');
  v_problema text;
  v_alvo     bigint;
  v_letra    text;
  v_novo     text;
  v_titulo   text;
  v_num      integer;
  v_id       bigint;
  v_nova     boolean := false;
begin
  if v_eu is null or not app.is_manager() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  select * into s from public.ia_notas_sugeridas where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'nao_existe');
  end if;
  if s.situacao <> 'sugerida' then
    return jsonb_build_object('ok', false, 'motivo', 'ja_decidida', 'situacao', s.situacao,
                              'por', (select t.full_name from public.team_directory t where t.id = s.decidido_por));
  end if;
  if p_escopo is null or p_escopo not in ('imovel', 'geral') then
    return jsonb_build_object('ok', false, 'motivo', 'escopo_invalido');
  end if;
  if p_escopo = 'imovel' and s.anuncio_id is null then
    return jsonb_build_object('ok', false, 'motivo', 'sem_imovel');
  end if;
  -- Sem texto, vai o que a IA escreveu para o alcance escolhido.
  v_texto := coalesce(v_texto, case p_escopo when 'imovel' then s.texto_imovel else s.texto_geral end);
  v_problema := app.ia_nota_problema(v_texto);
  if v_problema is not null then
    return jsonb_build_object('ok', false, 'motivo', 'texto_' || v_problema);
  end if;
  select * into d from public.ia_decisoes where id = s.decisao_id;

  -- Uma escrita por vez no caderno: duas respostas guardadas na mesma ficha ao
  -- mesmo tempo não podem ganhar a mesma letra.
  perform pg_advisory_xact_lock(hashtext('ia_caderno_aprende'));
  v_alvo := app.ia_nota_alvo(p_escopo, s.anuncio_id);
  if v_alvo is not null then
    select * into k from public.ia_caderno where id = v_alvo for update;
    v_letra := app.ia_nota_proxima_letra(k.texto);
    v_novo := rtrim(k.texto) || ' ' || app.ia_nota_item(v_letra, v_texto, d.decidido_em);
    if char_length(btrim(v_novo)) <= 2000 then
      update public.ia_caderno
         set texto = v_novo, atualizado_por = v_eu, atualizado_em = now()
       where id = k.id;
      v_id := k.id;
      v_titulo := app.ia_nota_titulo(k.texto);
    else
      -- A nota cheia ganha uma continuação, com o mesmo endereço.
      v_titulo := app.ia_nota_titulo(k.texto);
      if v_titulo !~ ', CONTINUAÇÃO$' then
        v_titulo := left(v_titulo, 105) || ', CONTINUAÇÃO';
      end if;
      insert into public.ia_caderno (texto, origem, conversation_id, message_id, criado_por, papel, anuncio_ids)
      values (v_titulo || ': ' || app.ia_nota_item('a', v_texto, d.decidido_em), 'resposta',
              s.conversation_id, d.mensagem_id, v_eu, k.papel, k.anuncio_ids)
      returning id into v_id;
      v_nova := true;
    end if;
  else
    if p_escopo = 'imovel' then
      select coalesce(max((regexp_match(c.texto, '^FICHA ([0-9]+)'))[1]::integer), 0) + 1
        into v_num from public.ia_caderno c;
      v_titulo := 'FICHA ' || v_num || '. '
                  || coalesce(s.titulo_da_ficha, app.ia_nota_titulo_do_anuncio(s.anuncio_id), 'IMÓVEL');
    else
      v_titulo := 'O QUE A IMOVA JÁ RESPONDEU (vale para todos os imóveis)';
    end if;
    insert into public.ia_caderno (texto, origem, conversation_id, message_id, criado_por, papel, anuncio_ids)
    values (v_titulo || ': ' || app.ia_nota_item('a', v_texto, d.decidido_em), 'resposta',
            s.conversation_id, d.mensagem_id, v_eu,
            case p_escopo when 'imovel' then 'ficha' else 'geral' end,
            case p_escopo when 'imovel' then array[s.anuncio_id] end)
    returning id into v_id;
    v_nova := true;
  end if;

  update public.ia_notas_sugeridas
     set situacao = 'guardada', escopo = p_escopo, texto_guardado = v_texto, caderno_id = v_id,
         decidido_por = v_eu, decidido_em = now()
   where id = s.id;
  return jsonb_build_object('ok', true, 'caderno_id', v_id, 'nova', v_nova, 'onde', v_titulo,
                            'texto', v_texto);
end $$;
comment on function public.ia_nota_guardar(uuid, text, text) is
  'Guarda no caderno a resposta sugerida (Imova, 27/11/2026): "imovel" entra na ficha do imóvel como o próximo item (sem ficha, nasce uma), "geral" na nota geral (sem ela, nasce uma). p_texto troca o texto da IA (passa pela mesma trava). Gestão; uma vez por sugestão.';
revoke all on function public.ia_nota_guardar(uuid, text, text) from public, anon;
grant execute on function public.ia_nota_guardar(uuid, text, text) to authenticated;

create or replace function public.ia_nota_descartar(p_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  s    public.ia_notas_sugeridas%rowtype;
  v_eu uuid := auth.uid();
begin
  if v_eu is null or not app.is_manager() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  select * into s from public.ia_notas_sugeridas where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'nao_existe');
  end if;
  if s.situacao <> 'sugerida' then
    return jsonb_build_object('ok', false, 'motivo', 'ja_decidida', 'situacao', s.situacao,
                              'por', (select t.full_name from public.team_directory t where t.id = s.decidido_por));
  end if;
  update public.ia_notas_sugeridas
     set situacao = 'descartada', decidido_por = v_eu, decidido_em = now()
   where id = s.id;
  return jsonb_build_object('ok', true);
end $$;
comment on function public.ia_nota_descartar(uuid) is
  '"Agora não" na nota sugerida (Imova, 27/11/2026): ela sai das sugeridas e nada entra no caderno. Gestão.';
revoke all on function public.ia_nota_descartar(uuid) from public, anon;
grant execute on function public.ia_nota_descartar(uuid) to authenticated;
  $ddl$;
end
$imova$;

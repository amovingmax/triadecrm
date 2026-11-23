-- =====================================================================
-- A IA que atende procura no mapa o lugar que o cliente citou — só na Imova
-- (23/11/2026)
--
-- O usuário, depois da Alinne (23/11): a cliente disse "terreno em Camurupim",
-- "perto do Condomínio Serv Club", "Condomínio Itapetinga" e mandou "Avenida Praia
-- de Camurupim, Nísia Floresta, 59164-000", e ninguém achou o terreno (o TE0004).
-- "Preciso que sempre que for passada alguma informação relevante, tipo algum ponto
-- de referência, 'é perto de...', 'fica nas proximidades de...', você use métodos de
-- busca e consiga buscar a referência que o cliente passou e verifique se bate com
-- algum terreno/imóvel nosso."
--
-- O caminho é o da foto (20261109130000): roda antes de a IA escrever, uma vez por
-- mensagem, e o que sai é escrito na conversa que ela lê. O worker
-- (`apps/workers/src/ia/referencias-de-lugar.ts`):
--   1. pega as mensagens de texto do cliente ainda não lidas para o mapa;
--   2. só chama o modelo (`referencias-de-lugar@v1`) quando há pista de lugar;
--   3. procura cada lugar no mapa (Google, se houver chave no worker; senão
--      OpenStreetMap), calcula a distância até cada imóvel e grava a anotação
--      "[no mapa: ...]", que entra no fim do texto da mensagem.
--
-- O QUE ENTRA (só na Imova):
--   1. `public.ia_lugares_no_mapa`: o cache do mapa, uma linha por pergunta e por
--      fonte. A política do Nominatim pede cache; os termos do Google só deixam
--      guardar `place_id` e lat/lng por 30 dias, então da linha do Google não se
--      guarda nome nem endereço (`lugar` é nulo, CHECK) e ela vence em 30 dias.
--   2. `public.ia_referencias_de_lugar`: o que saiu de cada mensagem do cliente (os
--      lugares, o que o mapa achou, os imóveis perto e a anotação). Uma linha por
--      mensagem: a mensagem é lida uma vez só.
--   3. As portas do worker (só `service_role`): os textos do cliente, gravar a
--      leitura, as anotações da conversa, ler e gravar o cache e onde ficam os
--      imóveis que a IA conhece (o pino do anúncio, quando há).
--
-- O que NÃO muda: nada no WhatsApp, nada nos anúncios (o pino continua o do
-- anúncio; o imóvel sem pino ganha um pino aproximado no worker, pelo cache, sem
-- gravar no anúncio).
--
-- Na KOMUNE não faz nada: a IA que atende não existe lá.
--
-- COMO DESFAZER:
--   drop function public.ia_imoveis_no_mapa();
--   drop function public.ia_lugar_no_mapa_gravar(text, text, boolean, double precision,
--     double precision, text, text, text, text);
--   drop function public.ia_lugar_no_mapa_ler(text);
--   drop function public.ia_referencias_da_conversa(uuid);
--   drop function public.ia_referencia_gravar(uuid, text, jsonb, text, bigint);
--   drop function public.ia_textos_do_cliente_para_o_mapa(uuid);
--   drop function app.ia_chave_do_lugar(text);
--   drop table public.ia_referencias_de_lugar; drop table public.ia_lugares_no_mapa;
-- =====================================================================

do $mapa$
begin
  if (select i.empresa from app.identidade i) = 'komune' then
    raise notice 'A IA que atende é só da Imova: no banco da KOMUNE nada foi criado.';
    return;
  end if;

  execute $ddl$
-- ---------------------------------------------------------------------
-- 0. A chave de uma pergunta ao mapa: sem acento, minúscula, um espaço só
-- ---------------------------------------------------------------------
create or replace function app.ia_chave_do_lugar(p_consulta text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(lower(extensions.unaccent(btrim(regexp_replace(coalesce(p_consulta, ''), '\s+', ' ', 'g')))), '')
$$;
revoke all on function app.ia_chave_do_lugar(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 1. O cache do mapa
-- ---------------------------------------------------------------------
create table if not exists public.ia_lugares_no_mapa (
  consulta    text not null check (char_length(consulta) between 1 and 300),
  fonte       text not null check (fonte in ('nominatim', 'google')),
  encontrado  boolean not null,
  lat         double precision check (lat between -90 and 90),
  lng         double precision check (lng between -180 and 180),
  -- Para que serve o ponto: 'ponto' (rua, condomínio, praia, lugar conhecido) dá
  -- distância; 'cidade' (cidade inteira, CEP terminado em 000) só diz a cidade.
  nivel       text check (nivel in ('ponto', 'bairro', 'cidade')),
  -- Só do OpenStreetMap (ODbL, com atribuição): "Camurupim, Nísia Floresta".
  lugar       text check (char_length(lugar) <= 160),
  cidade      text check (char_length(cidade) <= 80),
  place_id    text check (char_length(place_id) <= 300),
  licenca     text check (char_length(licenca) <= 300),
  buscado_em  timestamptz not null default now(),
  expira_em   timestamptz not null,
  primary key (consulta, fonte),
  constraint ia_lugares_no_mapa_achado_ck check (
    (encontrado and lat is not null and lng is not null and nivel is not null)
    or (not encontrado and lat is null and lng is null)),
  -- Os termos do Google: da resposta dele, só place_id e lat/lng, por até 30 dias.
  constraint ia_lugares_no_mapa_google_ck check (
    fonte <> 'google' or (lugar is null and cidade is null and expira_em <= buscado_em + interval '30 days'))
);
alter table public.ia_lugares_no_mapa enable row level security;
comment on table public.ia_lugares_no_mapa is
  'Cache do mapa da IA que atende (Imova, 23/11/2026): onde fica cada lugar que um cliente citou ou que um anúncio sem pino tem. Do Google, só place_id e lat/lng por 30 dias; do OpenStreetMap, o ponto e o nome curto (ODbL). Só o worker lê e grava.';

-- ---------------------------------------------------------------------
-- 2. O que saiu de cada mensagem do cliente
-- ---------------------------------------------------------------------
create table if not exists public.ia_referencias_de_lugar (
  message_id      uuid primary key references public.messages (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  -- 'sem_pista': o filtro não achou palavra de lugar e o modelo nem foi chamado.
  -- 'modelo': o modelo leu; `referencias` traz o que ele achou (pode ser nada).
  metodo          text not null check (metodo in ('sem_pista', 'modelo')),
  referencias     jsonb not null default '[]'::jsonb check (jsonb_typeof(referencias) = 'array'),
  -- O que entra na conversa, no fim do texto da mensagem: "[no mapa: ...]".
  anotacao        text check (char_length(anotacao) between 1 and 900),
  ai_run_id       bigint references public.ai_runs (id) on delete set null,
  criada_em       timestamptz not null default now()
);
create index if not exists ia_referencias_de_lugar_conversa_idx
  on public.ia_referencias_de_lugar (conversation_id);
alter table public.ia_referencias_de_lugar enable row level security;
drop policy if exists ia_referencias_de_lugar_select on public.ia_referencias_de_lugar;
create policy ia_referencias_de_lugar_select on public.ia_referencias_de_lugar
  for select to authenticated using ((select app.is_manager()));
comment on table public.ia_referencias_de_lugar is
  'Os lugares que o cliente citou em cada mensagem (rua, praia, condomínio, ponto, CEP), o que o mapa achou e os imóveis da Imova perto, segundo a IA que atende (23/11/2026).';

-- ---------------------------------------------------------------------
-- 3. As portas do worker
-- ---------------------------------------------------------------------

-- As mensagens de texto do cliente entre as 40 que a IA lê, da mais antiga para a
-- mais nova, com `pendente` = ainda não lida para o mapa. As já lidas servem de
-- contexto (a cidade dita antes).
create or replace function public.ia_textos_do_cliente_para_o_mapa(p_conversation_id uuid)
returns table (message_id uuid, texto text, recebida_em timestamptz, pendente boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select x.id, left(btrim(x.body), 600), x.created_at,
         not exists (select 1 from public.ia_referencias_de_lugar r where r.message_id = x.id)
    from (select m.id, m.body, m.created_at, m.direction, m.type, m.apagada_em, m.apagada_pelo_contato_em
            from public.messages m
           where m.conversation_id = p_conversation_id
             and m.type not in ('reaction'::app.msg_type, 'system'::app.msg_type)
           order by m.created_at desc, m.id desc
           limit 40) x
   where x.direction = 'in'::app.msg_direction
     and x.type = 'text'::app.msg_type
     and nullif(btrim(coalesce(x.body, '')), '') is not null
     and x.apagada_em is null and x.apagada_pelo_contato_em is null
   order by x.created_at, x.id
$$;
revoke all on function public.ia_textos_do_cliente_para_o_mapa(uuid) from public, anon, authenticated;
grant execute on function public.ia_textos_do_cliente_para_o_mapa(uuid) to service_role;

-- Grava a leitura de uma mensagem. Só mensagem de texto do cliente; ler de novo
-- troca a leitura (o worker só relê o que falhou).
create or replace function public.ia_referencia_gravar(
  p_message_id uuid, p_metodo text, p_referencias jsonb, p_anotacao text, p_ai_run_id bigint default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  m public.messages%rowtype;
begin
  select * into m from public.messages where id = p_message_id;
  if not found or m.direction <> 'in'::app.msg_direction or m.type <> 'text'::app.msg_type then
    return jsonb_build_object('ok', false, 'motivo', 'nao_e_texto_do_cliente');
  end if;
  if p_metodo is null or p_metodo not in ('sem_pista', 'modelo') then
    return jsonb_build_object('ok', false, 'motivo', 'metodo_invalido');
  end if;
  insert into public.ia_referencias_de_lugar (message_id, conversation_id, metodo, referencias, anotacao, ai_run_id)
  values (m.id, m.conversation_id, p_metodo,
          case when jsonb_typeof(p_referencias) = 'array' then p_referencias else '[]'::jsonb end,
          left(nullif(btrim(coalesce(p_anotacao, '')), ''), 900),
          p_ai_run_id)
  on conflict (message_id) do update
    set metodo = excluded.metodo, referencias = excluded.referencias,
        anotacao = excluded.anotacao, ai_run_id = excluded.ai_run_id, criada_em = now();
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.ia_referencia_gravar(uuid, text, jsonb, text, bigint) from public, anon, authenticated;
grant execute on function public.ia_referencia_gravar(uuid, text, jsonb, text, bigint) to service_role;

-- As anotações da conversa (o worker as põe no fim do texto de cada mensagem).
create or replace function public.ia_referencias_da_conversa(p_conversation_id uuid)
returns table (message_id uuid, anotacao text)
language sql
stable
security definer
set search_path = ''
as $$
  select r.message_id, r.anotacao
    from public.ia_referencias_de_lugar r
   where r.conversation_id = p_conversation_id
     and r.anotacao is not null
$$;
revoke all on function public.ia_referencias_da_conversa(uuid) from public, anon, authenticated;
grant execute on function public.ia_referencias_da_conversa(uuid) to service_role;

-- O que o cache sabe de uma pergunta, por fonte, sem o que já venceu.
create or replace function public.ia_lugar_no_mapa_ler(p_consulta text)
returns table (fonte text, encontrado boolean, lat double precision, lng double precision,
               nivel text, lugar text, cidade text)
language sql
stable
security definer
set search_path = ''
as $$
  select l.fonte, l.encontrado, l.lat, l.lng, l.nivel, l.lugar, l.cidade
    from public.ia_lugares_no_mapa l
   where l.consulta = app.ia_chave_do_lugar(p_consulta)
     and l.expira_em > now()
$$;
revoke all on function public.ia_lugar_no_mapa_ler(text) from public, anon, authenticated;
grant execute on function public.ia_lugar_no_mapa_ler(text) to service_role;

-- Grava a resposta do mapa. Quanto ela vale: do Google, 30 dias (os termos dele);
-- do OpenStreetMap achado, 180 dias; "não achado", 30 dias (o mapa aprende lugar
-- novo, e a pergunta volta a ser feita). Do Google nunca se grava nome nem cidade.
create or replace function public.ia_lugar_no_mapa_gravar(
  p_consulta text, p_fonte text, p_encontrado boolean,
  p_lat double precision, p_lng double precision, p_nivel text,
  p_lugar text, p_place_id text, p_licenca text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_chave text := app.ia_chave_do_lugar(p_consulta);
  v_achou boolean := coalesce(p_encontrado, false) and p_lat is not null and p_lng is not null;
  v_nivel text := case when p_nivel in ('ponto', 'bairro', 'cidade') then p_nivel else 'ponto' end;
begin
  if v_chave is null or char_length(v_chave) > 300 then
    return jsonb_build_object('ok', false, 'motivo', 'consulta_invalida');
  end if;
  if p_fonte is null or p_fonte not in ('nominatim', 'google') then
    return jsonb_build_object('ok', false, 'motivo', 'fonte_invalida');
  end if;
  insert into public.ia_lugares_no_mapa (consulta, fonte, encontrado, lat, lng, nivel, lugar, cidade,
                                         place_id, licenca, buscado_em, expira_em)
  values (v_chave, p_fonte, v_achou,
          case when v_achou then p_lat end,
          case when v_achou then p_lng end,
          case when v_achou then v_nivel end,
          case when v_achou and p_fonte = 'nominatim' then left(nullif(btrim(coalesce(p_lugar, '')), ''), 160) end,
          null,
          left(nullif(btrim(coalesce(p_place_id, '')), ''), 300),
          left(nullif(btrim(coalesce(p_licenca, '')), ''), 300),
          now(),
          now() + case when p_fonte = 'google' or not v_achou then interval '30 days' else interval '180 days' end)
  on conflict (consulta, fonte) do update
    set encontrado = excluded.encontrado, lat = excluded.lat, lng = excluded.lng,
        nivel = excluded.nivel, lugar = excluded.lugar, cidade = excluded.cidade,
        place_id = excluded.place_id, licenca = excluded.licenca,
        buscado_em = excluded.buscado_em, expira_em = excluded.expira_em;
  return jsonb_build_object('ok', true, 'encontrado', v_achou);
end $$;
revoke all on function public.ia_lugar_no_mapa_gravar(text, text, boolean, double precision, double precision,
  text, text, text, text) from public, anon, authenticated;
grant execute on function public.ia_lugar_no_mapa_gravar(text, text, boolean, double precision, double precision,
  text, text, text, text) to service_role;

-- Onde ficam os imóveis que a IA conhece (os mesmos de `app.ia_atendente_imoveis`):
-- o pino do anúncio quando há, e o endereço INTEIRO (só para o worker achar o pino
-- do anúncio que não tem; ele não vai ao modelo).
create or replace function public.ia_imoveis_no_mapa()
returns table (codigo text, tipo text, situacao text, bairro text, cidade text,
               endereco text, cep text, latitude double precision, longitude double precision)
language sql
stable
security definer
set search_path = ''
as $$
  select i ->> 'codigo', i ->> 'tipo', i ->> 'situacao', i ->> 'bairro', i ->> 'cidade',
         coalesce(nullif(btrim(a.endereco), ''), nullif(btrim(i ->> 'rua'), '')),
         nullif(btrim(a.cep), ''),
         a.latitude::double precision, a.longitude::double precision
    from jsonb_array_elements(app.ia_atendente_imoveis()) i
    left join lateral (
      select x.endereco, x.cep, x.latitude, x.longitude
        from public.anuncios x
       where x.excluido_em is null and x.codigo = i ->> 'codigo'
       order by x.updated_at desc nulls last
       limit 1) a on true
   where nullif(btrim(i ->> 'codigo'), '') is not null
$$;
revoke all on function public.ia_imoveis_no_mapa() from public, anon, authenticated;
grant execute on function public.ia_imoveis_no_mapa() to service_role;
  $ddl$;
end
$mapa$;

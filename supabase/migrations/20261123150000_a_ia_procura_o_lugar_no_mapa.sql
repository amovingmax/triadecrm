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
-- (`apps/workers/src/ia/localizador.ts`):
--   1. pega as mensagens de texto do cliente ainda não lidas para o mapa;
--   2. só chama o agente (`localizador-imova@v1`) quando há pista de lugar;
--   3. o Localizador procura no mapa (só OpenStreetMap, decisão do usuário em
--      23/11), reformula quando não acha, e pergunta ao CÓDIGO quais imóveis
--      ficam perto (a distância é calculada, nunca adivinhada); a conclusão vira
--      a anotação "[no mapa: ...]", no fim do texto da mensagem.
--
-- O QUE ENTRA (só na Imova):
--   1. `public.ia_lugares_no_mapa`: o cache do mapa (OpenStreetMap, ODbL), uma
--      linha por pergunta, com até 3 resultados. A política do Nominatim pede
--      cache: a mesma pergunta não volta ao serviço enquanto a linha vale.
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
--   drop function public.ia_lugar_no_mapa_gravar(text, jsonb, text);
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
  consulta    text primary key check (char_length(consulta) between 1 and 300),
  -- Até 3 lugares, como o OpenStreetMap devolveu: nome, tipo (addresstype), nível
  -- ('ponto' dá distância; 'cidade' só diz a cidade), bairro, cidade, lat, lng.
  -- Lista vazia = o mapa não conhece o lugar.
  resultados  jsonb not null default '[]'::jsonb
                check (jsonb_typeof(resultados) = 'array' and jsonb_array_length(resultados) <= 3),
  licenca     text check (char_length(licenca) <= 300),
  buscado_em  timestamptz not null default now(),
  expira_em   timestamptz not null
);
alter table public.ia_lugares_no_mapa enable row level security;
comment on table public.ia_lugares_no_mapa is
  'Cache do mapa da IA que atende (Imova, 23/11/2026): o que o OpenStreetMap (ODbL) devolveu para cada lugar que o Localizador procurou ou que um anúncio sem pino tem. Só o worker lê e grava.';

-- ---------------------------------------------------------------------
-- 2. O que saiu de cada mensagem do cliente
-- ---------------------------------------------------------------------
create table if not exists public.ia_referencias_de_lugar (
  message_id      uuid primary key references public.messages (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  -- 'sem_pista': o filtro não achou palavra de lugar e o agente nem foi chamado.
  -- 'localizador': o Localizador leu; `referencias` traz o que ele procurou e achou.
  metodo          text not null check (metodo in ('sem_pista', 'localizador')),
  referencias     jsonb not null default '{}'::jsonb check (jsonb_typeof(referencias) in ('object', 'array')),
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
  'Os lugares que o cliente citou em cada mensagem (rua, praia, condomínio, ponto, CEP), o que o Localizador achou no mapa e o imóvel da Imova que bate, segundo a IA que atende (23/11/2026).';

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
  if p_metodo is null or p_metodo not in ('sem_pista', 'localizador') then
    return jsonb_build_object('ok', false, 'motivo', 'metodo_invalido');
  end if;
  insert into public.ia_referencias_de_lugar (message_id, conversation_id, metodo, referencias, anotacao, ai_run_id)
  values (m.id, m.conversation_id, p_metodo,
          case when jsonb_typeof(p_referencias) in ('object', 'array') then p_referencias else '{}'::jsonb end,
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

-- O que o cache sabe de uma pergunta, se ainda vale (nada = perguntar ao mapa).
create or replace function public.ia_lugar_no_mapa_ler(p_consulta text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select l.resultados
    from public.ia_lugares_no_mapa l
   where l.consulta = app.ia_chave_do_lugar(p_consulta)
     and l.expira_em > now()
$$;
revoke all on function public.ia_lugar_no_mapa_ler(text) from public, anon, authenticated;
grant execute on function public.ia_lugar_no_mapa_ler(text) to service_role;

-- Grava a resposta do mapa. Achado vale 180 dias; "não achado", 30 (o mapa aprende
-- lugar novo, e a pergunta volta a ser feita). Mais de 3 resultados ficam os 3
-- primeiros.
create or replace function public.ia_lugar_no_mapa_gravar(p_consulta text, p_resultados jsonb, p_licenca text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_chave text := app.ia_chave_do_lugar(p_consulta);
  v_lista jsonb := case when jsonb_typeof(p_resultados) = 'array' then p_resultados else '[]'::jsonb end;
begin
  if v_chave is null or char_length(v_chave) > 300 then
    return jsonb_build_object('ok', false, 'motivo', 'consulta_invalida');
  end if;
  if jsonb_array_length(v_lista) > 3 then
    select coalesce(jsonb_agg(e order by n), '[]'::jsonb) into v_lista
      from jsonb_array_elements(v_lista) with ordinality as t(e, n) where n <= 3;
  end if;
  insert into public.ia_lugares_no_mapa (consulta, resultados, licenca, buscado_em, expira_em)
  values (v_chave, v_lista, left(nullif(btrim(coalesce(p_licenca, '')), ''), 300), now(),
          now() + case when jsonb_array_length(v_lista) = 0 then interval '30 days' else interval '180 days' end)
  on conflict (consulta) do update
    set resultados = excluded.resultados, licenca = excluded.licenca,
        buscado_em = excluded.buscado_em, expira_em = excluded.expira_em;
  return jsonb_build_object('ok', true, 'resultados', jsonb_array_length(v_lista));
end $$;
revoke all on function public.ia_lugar_no_mapa_gravar(text, jsonb, text) from public, anon, authenticated;
grant execute on function public.ia_lugar_no_mapa_gravar(text, jsonb, text) to service_role;

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

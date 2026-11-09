-- =====================================================================
-- A IA que atende reconhece a foto do anúncio — só na Imova (09/11/2026)
--
-- O usuário, com o print do treino (o Janio mandou a foto da casa amarela com a
-- marca d'água IMOVA e "Gostaria de saber mais informações sobre esse imóvel", e
-- a IA pediu o código): "Ela deve ser capaz de analisar a imagem e saber de qual
-- anúncio, imóvel, terreno, lote se trata a imagem." E: "preciso que a IA também
-- saiba trabalhar com o valor [...] quartos (se tem suíte ou não), metragem [...],
-- endereço".
--
-- O QUE ENTRA (só na Imova):
--
--   1. `public.ia_impressoes`: a "impressão digital" (dHash de 64 bits, em hex)
--      de cada foto de referência de um anúncio. Duas origens: as fotos da aba
--      Anúncios (`anuncio_fotos`, balde `anuncios`) e as fotos que o Janio ensina
--      no treino ("essa foto é do terreno X", balde `mensagens`). O worker calcula
--      a impressão (sharp) e grava aqui; o banco só guarda.
--
--   2. `public.ia_fotos_reconhecidas`: o que a IA concluiu de cada foto que o
--      cliente mandou — o anúncio (ou nenhum), por qual caminho (`impressao`: a
--      mesma foto do anúncio, sem modelo; `visao`: o modelo comparou com as fotos
--      dos anúncios; `ensinada`: o Janio disse), a certeza e uma descrição curta.
--      Uma linha por mensagem: a foto é reconhecida uma vez só.
--
--   3. As portas do worker (só `service_role`): fotos sem impressão, gravar
--      impressão, as referências, as fotos do cliente ainda não reconhecidas,
--      gravar o reconhecimento, o reconhecimento da conversa e ensinar uma foto
--      (só na conversa do treino).
--
--   4. `app.ia_atendente_imoveis()` passa a levar a descrição INTEIRA (antes, só os
--      primeiros 900 caracteres: nos terrenos de Capim Macio e Parnamirim a frente,
--      a esquina e as opções de metragem ficavam de fora) e o complemento do
--      endereço quando o anúncio mostra o endereço completo.
--
-- O que NÃO muda: nada no WhatsApp. O worker só LÊ a foto que já chegou (balde
-- `mensagens`) e as fotos dos anúncios (balde `anuncios`).
--
-- Na KOMUNE não faz nada: a IA que atende não existe lá.
--
-- COMO DESFAZER:
--   drop function public.ia_foto_ensinar(uuid, uuid, text, text);
--   drop function public.ia_fotos_reconhecidas_da_conversa(uuid);
--   drop function public.ia_foto_reconhecida_gravar(uuid, text, text, text, text, int, bigint);
--   drop function public.ia_fotos_do_cliente(uuid, int);
--   drop function public.ia_fotos_de_referencia();
--   drop function public.ia_impressao_gravar(uuid, text);
--   drop function public.ia_fotos_sem_impressao(int);
--   drop table public.ia_fotos_reconhecidas; drop table public.ia_impressoes;
--   e reaplicar `app.ia_atendente_imoveis` da 20261106170000.
-- =====================================================================

do $fotos$
begin
  if (select i.empresa from app.identidade i) = 'komune' then
    raise notice 'A IA que atende é só da Imova: no banco da KOMUNE nada foi criado.';
    return;
  end if;

  execute $ddl$
-- ---------------------------------------------------------------------
-- 1. As impressões das fotos de referência
-- ---------------------------------------------------------------------
create table if not exists public.ia_impressoes (
  id           uuid primary key default gen_random_uuid(),
  codigo       text not null check (char_length(codigo) between 1 and 80),
  -- O anúncio da aba Anúncios; nulo só na foto ensinada de um anúncio que
  -- existe apenas no Canal Pro.
  anuncio_id   uuid references public.anuncios (id) on delete cascade,
  origem       text not null check (origem in ('anuncio', 'ensinada')),
  foto_id      uuid unique references public.anuncio_fotos (id) on delete cascade,
  message_id   uuid unique references public.messages (id) on delete cascade,
  balde        text not null check (balde in ('anuncios', 'mensagens')),
  caminho      text not null check (char_length(caminho) between 1 and 300),
  posicao      int not null default 0,
  -- dHash de 64 bits em hex; nulo quando a foto não pôde ser lida (não tenta de novo).
  impressao    text check (impressao ~ '^[0-9a-f]{16}$'),
  criada_em    timestamptz not null default now(),
  constraint ia_impressoes_origem_ck check (
    (origem = 'anuncio' and foto_id is not null and message_id is null and balde = 'anuncios')
    or (origem = 'ensinada' and message_id is not null and foto_id is null and balde = 'mensagens'))
);
create index if not exists ia_impressoes_codigo_idx on public.ia_impressoes (codigo, origem, posicao);
alter table public.ia_impressoes enable row level security;
drop policy if exists ia_impressoes_select on public.ia_impressoes;
create policy ia_impressoes_select on public.ia_impressoes
  for select to authenticated using ((select app.is_manager()));
comment on table public.ia_impressoes is
  'A impressão digital (dHash) de cada foto de referência de um anúncio: as da aba Anúncios e as que o treino ensinou (Imova, 09/11/2026). Escrita só pelas portas do worker.';

-- ---------------------------------------------------------------------
-- 2. O que a IA concluiu de cada foto do cliente
-- ---------------------------------------------------------------------
create table if not exists public.ia_fotos_reconhecidas (
  message_id      uuid primary key references public.messages (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  codigo          text check (char_length(codigo) between 1 and 80),
  metodo          text not null
                    check (metodo in ('impressao', 'visao', 'ensinada', 'nao_reconheceu', 'indisponivel')),
  certeza         text check (certeza in ('alta', 'media', 'baixa')),
  descricao       text check (char_length(descricao) <= 300),
  -- Na impressão: quantos dos 64 bits diferem da foto do anúncio (0 = a mesma).
  distancia       int check (distancia between 0 and 64),
  ai_run_id       bigint references public.ai_runs (id) on delete set null,
  criada_em       timestamptz not null default now(),
  atualizada_em   timestamptz not null default now(),
  constraint ia_fotos_reconhecidas_codigo_ck check (
    (metodo in ('impressao', 'visao', 'ensinada') and codigo is not null)
    or (metodo in ('nao_reconheceu', 'indisponivel') and codigo is null))
);
create index if not exists ia_fotos_reconhecidas_conversa_idx
  on public.ia_fotos_reconhecidas (conversation_id);
alter table public.ia_fotos_reconhecidas enable row level security;
drop policy if exists ia_fotos_reconhecidas_select on public.ia_fotos_reconhecidas;
create policy ia_fotos_reconhecidas_select on public.ia_fotos_reconhecidas
  for select to authenticated using ((select app.is_manager()));
comment on table public.ia_fotos_reconhecidas is
  'De qual anúncio é cada foto que o cliente mandou, segundo a IA que atende (Imova, 09/11/2026): pela impressão digital, pela visão do modelo ou pelo treino.';

-- ---------------------------------------------------------------------
-- 3. As portas do worker
-- ---------------------------------------------------------------------

-- Fotos da aba Anúncios que ainda não têm impressão.
create or replace function public.ia_fotos_sem_impressao(p_limite int default 40)
returns table (foto_id uuid, codigo text, caminho text, posicao int)
language sql
stable
security definer
set search_path = ''
as $$
  select f.id, a.codigo, f.caminho, f.posicao
    from public.anuncio_fotos f
    join public.anuncios a on a.id = f.anuncio_id
   where a.excluido_em is null
     and not exists (select 1 from public.ia_impressoes i where i.foto_id = f.id)
   order by a.codigo, f.posicao, f.id
   limit greatest(least(coalesce(p_limite, 40), 200), 1)
$$;
revoke all on function public.ia_fotos_sem_impressao(int) from public, anon, authenticated;
grant execute on function public.ia_fotos_sem_impressao(int) to service_role;

-- Grava a impressão de uma foto da aba Anúncios (nula = não deu para ler).
create or replace function public.ia_impressao_gravar(p_foto_id uuid, p_impressao text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  f public.anuncio_fotos%rowtype;
  a public.anuncios%rowtype;
begin
  select * into f from public.anuncio_fotos where id = p_foto_id;
  if not found then
    return false;
  end if;
  select * into a from public.anuncios where id = f.anuncio_id;
  insert into public.ia_impressoes (codigo, anuncio_id, origem, foto_id, balde, caminho, posicao, impressao)
  values (a.codigo, a.id, 'anuncio', f.id, 'anuncios', f.caminho, f.posicao,
          case when p_impressao ~ '^[0-9a-f]{16}$' then p_impressao end)
  on conflict (foto_id) do update
    set impressao = excluded.impressao, codigo = excluded.codigo,
        caminho = excluded.caminho, posicao = excluded.posicao;
  return true;
end $$;
revoke all on function public.ia_impressao_gravar(uuid, text) from public, anon, authenticated;
grant execute on function public.ia_impressao_gravar(uuid, text) to service_role;

-- Todas as referências dos anúncios que a IA conhece: as da aba Anúncios (de
-- anúncio não excluído) e as ensinadas no treino.
create or replace function public.ia_fotos_de_referencia()
returns table (id uuid, codigo text, origem text, balde text, caminho text, posicao int, impressao text)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, i.codigo, i.origem, i.balde, i.caminho, i.posicao, i.impressao
    from public.ia_impressoes i
    left join public.anuncios a on a.id = i.anuncio_id
   where (i.anuncio_id is null or a.excluido_em is null)
     and (i.origem = 'ensinada'
          or exists (select 1 from public.anuncio_fotos f where f.id = i.foto_id))
   order by i.codigo, (i.origem = 'ensinada'), i.posicao, i.criada_em, i.id
$$;
revoke all on function public.ia_fotos_de_referencia() from public, anon, authenticated;
grant execute on function public.ia_fotos_de_referencia() to service_role;

-- As fotos que o cliente mandou entre as 40 mensagens que a IA lê e que ainda
-- não foram reconhecidas, as mais recentes primeiro. Figurinha não é foto.
create or replace function public.ia_fotos_do_cliente(p_conversation_id uuid, p_limite int default 3)
returns table (message_id uuid, media_path text, media_mime text, legenda text, recebida_em timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select x.id, x.media_path, x.media_mime, nullif(btrim(x.body), ''), x.created_at
    from (select m.id, m.media_path, m.media_mime, m.body, m.created_at, m.direction, m.type,
                 m.tipo_na_meta, m.apagada_em, m.apagada_pelo_contato_em
            from public.messages m
           where m.conversation_id = p_conversation_id
             and m.type not in ('reaction'::app.msg_type, 'system'::app.msg_type)
           order by m.created_at desc, m.id desc
           limit 40) x
   where x.direction = 'in'::app.msg_direction
     and x.type = 'image'::app.msg_type
     and x.tipo_na_meta is distinct from 'sticker'
     and x.media_path is not null
     and x.apagada_em is null and x.apagada_pelo_contato_em is null
     and not exists (select 1 from public.ia_fotos_reconhecidas r where r.message_id = x.id)
   order by x.created_at desc, x.id desc
   limit greatest(least(coalesce(p_limite, 3), 10), 1)
$$;
revoke all on function public.ia_fotos_do_cliente(uuid, int) from public, anon, authenticated;
grant execute on function public.ia_fotos_do_cliente(uuid, int) to service_role;

-- Grava o reconhecimento. Código que a IA não conhece (o modelo inventou, ou o
-- anúncio saiu) vira "não reconheceu": nunca se grava anúncio que não existe.
create or replace function public.ia_foto_reconhecida_gravar(
  p_message_id uuid, p_codigo text, p_metodo text, p_certeza text, p_descricao text,
  p_distancia int default null, p_ai_run_id bigint default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  m        public.messages%rowtype;
  v_codigo text := nullif(btrim(coalesce(p_codigo, '')), '');
  v_metodo text := p_metodo;
begin
  select * into m from public.messages where id = p_message_id;
  if not found or m.direction <> 'in'::app.msg_direction or m.type <> 'image'::app.msg_type then
    return jsonb_build_object('ok', false, 'motivo', 'nao_e_foto_do_cliente');
  end if;
  if v_metodo not in ('impressao', 'visao', 'nao_reconheceu', 'indisponivel') then
    return jsonb_build_object('ok', false, 'motivo', 'metodo_invalido');
  end if;
  if v_codigo is not null and not exists (
       select 1 from jsonb_array_elements(app.ia_atendente_imoveis()) i where i ->> 'codigo' = v_codigo) then
    v_codigo := null;
  end if;
  if v_codigo is null and v_metodo in ('impressao', 'visao') then
    v_metodo := 'nao_reconheceu';
  end if;
  if v_metodo in ('nao_reconheceu', 'indisponivel') then
    v_codigo := null;
  end if;
  insert into public.ia_fotos_reconhecidas (message_id, conversation_id, codigo, metodo, certeza,
                                            descricao, distancia, ai_run_id)
  values (m.id, m.conversation_id, v_codigo, v_metodo,
          case when v_codigo is null then null
               when p_certeza in ('alta', 'media', 'baixa') then p_certeza else 'baixa' end,
          left(nullif(btrim(coalesce(p_descricao, '')), ''), 300),
          case when p_distancia between 0 and 64 then p_distancia end,
          p_ai_run_id)
  -- O que o treino ensinou não é desfeito por uma leitura nova.
  on conflict (message_id) do update
    set codigo = excluded.codigo, metodo = excluded.metodo, certeza = excluded.certeza,
        descricao = excluded.descricao, distancia = excluded.distancia,
        ai_run_id = excluded.ai_run_id, atualizada_em = now()
    where public.ia_fotos_reconhecidas.metodo <> 'ensinada';
  return jsonb_build_object('ok', true, 'codigo', v_codigo, 'metodo', v_metodo);
end $$;
revoke all on function public.ia_foto_reconhecida_gravar(uuid, text, text, text, text, int, bigint)
  from public, anon, authenticated;
grant execute on function public.ia_foto_reconhecida_gravar(uuid, text, text, text, text, int, bigint)
  to service_role;

-- O que já se sabe das fotos da conversa (o worker escreve isso no lugar de "[foto]").
create or replace function public.ia_fotos_reconhecidas_da_conversa(p_conversation_id uuid)
returns table (message_id uuid, codigo text, metodo text, certeza text, descricao text)
language sql
stable
security definer
set search_path = ''
as $$
  select r.message_id, r.codigo, r.metodo, r.certeza, r.descricao
    from public.ia_fotos_reconhecidas r
   where r.conversation_id = p_conversation_id
$$;
revoke all on function public.ia_fotos_reconhecidas_da_conversa(uuid) from public, anon, authenticated;
grant execute on function public.ia_fotos_reconhecidas_da_conversa(uuid) to service_role;

-- O treino ensina uma foto: "essa foto é do anúncio X". Só na conversa do treino,
-- só foto que o "cliente" (o Janio) mandou nela, só anúncio que a IA conhece. A foto
-- vira referência do anúncio e a próxima igual é reconhecida pela impressão.
create or replace function public.ia_foto_ensinar(
  p_conversation_id uuid, p_message_id uuid, p_codigo text, p_impressao text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  m        public.messages%rowtype;
  v_codigo text := nullif(btrim(coalesce(p_codigo, '')), '');
  v_anuncio uuid;
begin
  if p_conversation_id is distinct from app.ia_conversa_de_treino() then
    return jsonb_build_object('ok', false, 'motivo', 'so_no_treino');
  end if;
  select * into m from public.messages where id = p_message_id;
  if not found or m.conversation_id <> p_conversation_id
     or m.direction <> 'in'::app.msg_direction or m.type <> 'image'::app.msg_type
     or m.media_path is null then
    return jsonb_build_object('ok', false, 'motivo', 'nao_e_foto_da_conversa');
  end if;
  if v_codigo is null or not exists (
       select 1 from jsonb_array_elements(app.ia_atendente_imoveis()) i where i ->> 'codigo' = v_codigo) then
    return jsonb_build_object('ok', false, 'motivo', 'anuncio_desconhecido');
  end if;
  select a.id into v_anuncio from public.anuncios a where a.codigo = v_codigo and a.excluido_em is null;

  insert into public.ia_impressoes (codigo, anuncio_id, origem, message_id, balde, caminho, posicao, impressao)
  values (v_codigo, v_anuncio, 'ensinada', m.id, 'mensagens', m.media_path, 1000,
          case when p_impressao ~ '^[0-9a-f]{16}$' then p_impressao end)
  on conflict (message_id) do update
    set codigo = excluded.codigo, anuncio_id = excluded.anuncio_id,
        impressao = coalesce(excluded.impressao, public.ia_impressoes.impressao);

  insert into public.ia_fotos_reconhecidas (message_id, conversation_id, codigo, metodo, certeza, descricao)
  values (m.id, m.conversation_id, v_codigo, 'ensinada', 'alta', 'ensinada no treino')
  on conflict (message_id) do update
    set codigo = excluded.codigo, metodo = 'ensinada', certeza = 'alta',
        descricao = excluded.descricao, distancia = null, atualizada_em = now();
  -- O caminho volta para o worker calcular a impressão e chamar de novo com ela.
  return jsonb_build_object('ok', true, 'codigo', v_codigo, 'caminho', m.media_path,
                            'tem_impressao', exists (select 1 from public.ia_impressoes i
                                                      where i.message_id = m.id and i.impressao is not null));
end $$;
revoke all on function public.ia_foto_ensinar(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.ia_foto_ensinar(uuid, uuid, text, text) to service_role;

-- ---------------------------------------------------------------------
-- 4. Os imóveis que a IA conhece: a descrição inteira e o complemento
-- ---------------------------------------------------------------------
create or replace function app.ia_atendente_imoveis()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_crm    jsonb := '[]'::jsonb;
  v_manual jsonb := '[]'::jsonb;
  -- Sem a regra do relatório (banco sem a 20261105150000), tudo conta como no ar.
  v_ativo  text := case when to_regprocedure('app.canal_pro_ativo_no_relatorio(text)') is not null
                        then 'app.canal_pro_ativo_no_relatorio(j ->> ''situacao'')'
                        else 'true' end;
begin
  if to_regclass('public.anuncios') is not null then
    begin
      execute $q$
        select coalesce(jsonb_agg(jsonb_build_object(
                 'codigo',          j ->> 'codigo',
                 'situacao',        j ->> 'situacao',
                 'titulo',          nullif(j ->> 'titulo', ''),
                 'tipo',            j ->> 'tipo',
                 'negocio',         j ->> 'negocio',
                 'preco_venda',     (j ->> 'preco_venda')::bigint,
                 'preco_aluguel',   (j ->> 'preco_aluguel')::bigint,
                 'periodo_aluguel', j ->> 'periodo_aluguel',
                 'condominio',      (j ->> 'condominio')::bigint,
                 'iptu',            (j ->> 'iptu')::bigint,
                 'iptu_periodo',    j ->> 'iptu_periodo',
                 'area_util',       (j ->> 'area_util')::int,
                 'area_total',      (j ->> 'area_total')::int,
                 'quartos',         (j ->> 'quartos')::int,
                 'suites',          (j ->> 'suites')::int,
                 'banheiros',       (j ->> 'banheiros')::int,
                 'vagas',           (j ->> 'vagas')::int,
                 'caracteristicas', coalesce(j -> 'caracteristicas', '[]'::jsonb),
                 'bairro',          j ->> 'bairro',
                 'cidade',          j ->> 'cidade',
                 'estado',          j ->> 'estado',
                 'rua',             case when j ->> 'mostrar_endereco' in ('completo', 'rua')
                                         then nullif(j ->> 'endereco', '') end,
                 'numero',          case when j ->> 'mostrar_endereco' = 'completo'
                                         then nullif(j ->> 'numero', '') end,
                 'complemento',     case when j ->> 'mostrar_endereco' = 'completo'
                                         then nullif(j ->> 'complemento', '') end,
                 -- Inteira desde 09/11/2026: medidas, esquina e frente moram aqui.
                 'descricao',       nullif(j ->> 'descricao', ''))
               order by j ->> 'codigo'), '[]'::jsonb)
          from (select to_jsonb(a) as j from public.anuncios a) s
         where (j ->> 'excluido_em') is null
      $q$ into v_crm;
    exception when others then
      raise warning 'ia_atendente_imoveis: não consegui ler public.anuncios: %', sqlerrm;
      v_crm := '[]'::jsonb;
    end;
  end if;

  if to_regclass('public.anuncios_no_canal_pro') is not null then
    begin
      execute format($q$
        select coalesce(jsonb_agg(jsonb_build_object(
                 'codigo',        j ->> 'codigo',
                 'situacao',      case when %s then 'no_ar' else 'pausado' end,
                 'titulo',        nullif(j ->> 'titulo', ''),
                 'tipo',          coalesce(j ->> 'tipo_crm', j ->> 'tipo'),
                 'negocio',       j ->> 'negocio',
                 'preco_venda',   (j ->> 'preco_venda')::bigint,
                 'preco_aluguel', (j ->> 'preco_aluguel')::bigint,
                 'area_util',     (j ->> 'area')::int,
                 'quartos',       (j ->> 'quartos')::int,
                 'bairro',        j ->> 'bairro',
                 'cidade',        j ->> 'cidade',
                 'rua',           nullif(j ->> 'endereco', ''))
               order by j ->> 'codigo'), '[]'::jsonb)
          from (select to_jsonb(m) as j from public.anuncios_no_canal_pro m) s
         where (j ->> 'excluido_em') is null
           and coalesce((j ->> 'no_relatorio')::boolean, true)
           and (j ->> 'anuncio_id') is null
      $q$, v_ativo) into v_manual;
    exception when others then
      raise warning 'ia_atendente_imoveis: não consegui ler public.anuncios_no_canal_pro: %', sqlerrm;
      v_manual := '[]'::jsonb;
    end;
  end if;

  return v_crm || v_manual;
end $$;
comment on function app.ia_atendente_imoveis() is
  'Os imóveis que a IA que atende conhece: os da aba Anúncios (menos os excluídos), com a descrição inteira desde 09/11/2026, e os anúncios feitos à mão no Canal Pro que ainda não vieram para o CRM (os inativos no relatório vão como pausado). Endereço só até onde o anúncio mostra.';
revoke all on function app.ia_atendente_imoveis() from public, anon, authenticated;
  $ddl$;
end $fotos$;

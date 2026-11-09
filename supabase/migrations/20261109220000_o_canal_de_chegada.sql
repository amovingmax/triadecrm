-- =====================================================================
-- O canal de chegada do lead: por onde a pessoa conheceu a Imova (06/11/2026)
--
-- Pedido do Rafael: "precisamos saber se ele entrou em contato e ficou sabendo
-- da gente por uma placa de anúncio cravada no local, pelos anúncios do Canal
-- Pro ou pelas redes sociais [...] a IA leia a mensagem inicial e identifique
-- através da conversa por qual meio veio esse lead". Decisões dele no mesmo
-- dia: os rótulos são Placa, Anúncios, Redes sociais e Indicação (mais o
-- estado Não identificado). Em 09/11/2026 a Indicação deu lugar a OUTROS
-- (indicação, site, Google e o resto viram Outros; Não identificado continua
-- sendo só "sem pista nenhuma"); aplicar a quem chegou desde 27/10/2026; admin,
-- gestor e SDR corrigem; a IA pode ler a foto; a etiqueta mostra só o canal;
-- foto da placa OU de um banner da Imova é Placa, fica registrada no
-- relatório, e o atendimento segue normal. Desenho em
-- docs/superpowers/specs/2026-11-06-canal-de-chegada-imova-design.md.
--
-- O QUE É UMA CHEGADA. Uma linha de `public.chegadas` por EPISÓDIO: a primeira
-- mensagem da pessoa na conversa, ou a volta dela depois de 30 dias sem nada
-- dos dois lados. É por conversa (e não por ficha) porque o lead sem ficha
-- também chega, as provas moram na conversa, e a mesma pessoa pode voltar
-- meses depois por outro canal. Conversa que NÓS abrimos (modelo, bom-dia)
-- não gera chegada: a pessoa não nos procurou.
--
-- QUEM DECIDE, em ordem:
--   1. Regra forte (≥ 0,90): o anúncio da Meta que o webhook já grava em
--      `messages.conteudo.anuncio` desde 27/10 (tipo "ad"); o lead do Canal Pro
--      (`app.canal_sinal_do_portal`, ponto de encaixe vazio até aquela branch
--      subir); link de portal no texto.
--   2. A IA (migração seguinte), que lê o começo da conversa e até 3 fotos.
--   3. Regra fraca (palavras como "vi a placa", "pelo insta"): decide na hora
--      para a etiqueta aparecer logo, e a IA pode trocar quando ler.
--   4. Gente: `public.chegada_marcar` grava em colunas próprias e VENCE
--      SEMPRE (`canal = coalesce(canal_marcado, canal_automatico)`). Nem a
--      regra nem a IA escrevem ali.
--   Em 24 h a chegada fecha; sem sinal, fica Não identificado.
--
-- POR QUE NÃO `organizations.source_id`, `tags` NEM A ETIQUETA ESCRITA. O
-- `source_id` diz como a FICHA entrou no CRM (a ficha automática grava
-- whatsapp_entrada em 1 minuto, antes de o canal ser conhecido) e alimenta a
-- frase do roteiro de ligação. `tags` e a etiqueta de texto livre são postas
-- por gente, só existem em ficha e não guardam prova nem confiança. Na tela o
-- canal parece etiqueta; por baixo é um conceito próprio, com prova.
--
-- O WHATSAPP NÃO MUDA. Nenhum gatilho, índice ou escrita em `messages` e
-- `conversations`: o `pg_cron` (agendado pelo seed da Imova) só LÊ as duas.
-- Nada aqui grava mensagem, enfileira envio ou mexe em janela, robô, ausência,
-- opt-out ou estado da conversa (`whatsapp-intocavel`; o pgTAP 137 prova).
--
-- SÓ DA IMOVA, no padrão da atitude e da ficha do cliente: no banco da
-- KOMUNE esta migração não cria nada (fica só o registro da versão); num banco
-- sem identidade (CI, db reset) tudo é criado; mesmo criado, só liga com
-- identidade "imova" (`app.canal_de_chegada_config`); a chave, os padrões de
-- texto e o job vêm do seed da Imova (bloco 12g).
-- =====================================================================

do $canal$
begin
  if (select i.empresa from app.identidade i) = 'komune' then
    raise notice 'O canal de chegada é só da Imova: no banco da KOMUNE nada foi criado.';
    return;
  end if;
  execute $ddl$

-- =====================================================================
-- 1. Configuração e vocabulário
-- =====================================================================
create or replace function app.canal_de_chegada_config()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select '{"ligada": false,
           "ia": false,
           "piloto_numeros": [],
           "aplicar_desde": "2026-10-27",
           "nova_chegada_apos_dias": 30,
           "espera_min": 3,
           "silencio_min": 2,
           "teto_continuo_min": 15,
           "foto_ate_min": 30,
           "foto_desiste_min": 10,
           "fotos_max": 3,
           "foto_bytes_max": 5242880,
           "leituras_ia_max": 2,
           "reavaliar_horas": 24,
           "ia_confianca_minima": 0.6,
           "releitura_abaixo_de": 0.8}'::jsonb
         || coalesce((select s.value from public.app_settings s where s.key = 'canal_de_chegada'), '{}'::jsonb)
         -- Fora da Imova, desligado sempre, diga o que disser a configuração.
         || case when (select i.empresa from app.identidade i) = 'imova' then '{}'::jsonb
                 else '{"ligada": false, "ia": false}'::jsonb end
$$;
comment on function app.canal_de_chegada_config() is
  'A configuração do canal de chegada, com os padrões por baixo do que estiver em app_settings[''canal_de_chegada'']. Só liga no banco da Imova (app.identidade): fora dela, ligada e ia são sempre false.';
revoke all on function app.canal_de_chegada_config() from public, anon;

-- O par canal/subcanal. Espelhado em packages/schema/src/canal-de-chegada.ts.
create or replace function app.canal_subcanal_valido(p_canal text, p_subcanal text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(case p_canal
    when 'placa'            then p_subcanal in ('foto_da_placa', 'foto_do_banner', 'texto_da_placa')
    when 'anuncios'         then p_subcanal in ('meta_anuncio', 'canal_pro', 'portal_zap', 'portal_vivareal',
                                                'portal_olx', 'anuncio_outro')
    when 'redes_sociais'    then p_subcanal in ('instagram', 'facebook', 'tiktok', 'youtube', 'meta_post',
                                                'rede_outra')
    when 'outros'           then p_subcanal in ('indicacao', 'site', 'google', 'outro_meio')
    when 'nao_identificado' then p_subcanal = 'desconhecido'
    else false end, false)
$$;
comment on function app.canal_subcanal_valido(text, text) is
  'Se o subcanal pertence ao canal (placa, anuncios, redes_sociais, outros, nao_identificado). A mesma lista de packages/schema/src/canal-de-chegada.ts.';

-- O subcanal de quando ninguém disse qual (a correção de gente sem subcanal).
create or replace function app.canal_subcanal_padrao(p_canal text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_canal
    when 'placa' then 'texto_da_placa'
    when 'anuncios' then 'anuncio_outro'
    when 'redes_sociais' then 'rede_outra'
    when 'outros' then 'outro_meio'
    when 'nao_identificado' then 'desconhecido' end
$$;

create or replace function app.canal_rotulo(p_canal text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_canal
    when 'placa' then 'Placa'
    when 'anuncios' then 'Anúncios'
    when 'redes_sociais' then 'Redes sociais'
    when 'outros' then 'Outros'
    when 'nao_identificado' then 'Não identificado'
    else p_canal end
$$;

-- O texto em que as regras procuram: minúsculo, sem acento, até 500 letras.
create or replace function app.canal_texto(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(extensions.unaccent(left(coalesce(p, ''), 500)))
$$;

create or replace function app.canal_regex_valida(p text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p is null or length(p) not between 2 and 400 then
    return false;
  end if;
  perform '' ~ p;
  return true;
exception when others then
  return false;
end $$;

-- As ajudantes puras ficam fora do alcance de quem não entrou (pgTAP 09: anon
-- não executa nada do schema app, nem pelo EXECUTE de PUBLIC). Quem entrou
-- precisa delas: o CHECK de canal_padroes e as telas que leem as views.
revoke all on function app.canal_subcanal_valido(text, text) from public, anon;
revoke all on function app.canal_subcanal_padrao(text) from public, anon;
revoke all on function app.canal_rotulo(text) from public, anon;
revoke all on function app.canal_texto(text) from public, anon;
revoke all on function app.canal_regex_valida(text) from public, anon;
grant execute on function app.canal_subcanal_valido(text, text) to authenticated, service_role;
grant execute on function app.canal_subcanal_padrao(text) to authenticated, service_role;
grant execute on function app.canal_rotulo(text) to authenticated, service_role;
grant execute on function app.canal_texto(text) to authenticated, service_role;
grant execute on function app.canal_regex_valida(text) to authenticated, service_role;

-- =====================================================================
-- 2. As chegadas, o histórico, os padrões de texto e o cursor do cron
-- =====================================================================
create table if not exists public.chegadas (
  id                    uuid primary key default gen_random_uuid(),
  conversation_id       uuid not null references public.conversations (id) on delete cascade,
  -- Sem FK de propósito: FK em `messages` poria trava na tabela mais quente
  -- do WhatsApp a cada chegada gravada.
  primeira_mensagem_id  uuid not null unique,
  inicio_em             timestamptz not null,
  situacao              text not null default 'lendo' check (situacao in ('lendo', 'fechada')),
  -- O que a regra ou a IA decidiu. Nulo enquanto ninguém decidiu.
  canal_automatico      text check (canal_automatico in ('placa', 'anuncios', 'redes_sociais', 'outros',
                                                         'nao_identificado')),
  subcanal_automatico   text,
  confianca             numeric(3, 2) check (confianca between 0 and 1),
  decidido_por          text check (decidido_por in ('regra', 'ia')),
  regra_slug            text,
  regra_forte           boolean not null default false,
  ai_run_id             bigint references public.ai_runs (id) on delete set null,
  -- [{message_id, tipo: anuncio_meta|portal|texto|foto, trecho}]
  evidencias            jsonb not null default '[]'::jsonb check (jsonb_typeof(evidencias) = 'array'),
  -- O que a IA viu na foto: {message_id, peca, marca, descricao, codigo_do_imovel}. Nunca a imagem.
  foto                  jsonb check (foto is null or jsonb_typeof(foto) = 'object'),
  -- O código do anúncio que veio no texto pronto do portal ("Código da oferta:
  -- TE0002_IMOVA"): de qual anúncio o lead chegou.
  codigo_do_anuncio     text check (codigo_do_anuncio is null or codigo_do_anuncio ~ '^[A-Za-z0-9_-]{2,50}$'),
  -- A última resposta da IA, mesmo quando não valeu (abaixo do limiar, regra forte, gente).
  sugestao_da_ia        jsonb,
  motivo                text,
  -- A correção de gente.
  canal_marcado         text check (canal_marcado in ('placa', 'anuncios', 'redes_sociais', 'outros',
                                                      'nao_identificado')),
  subcanal_marcado      text,
  marcado_em            timestamptz,
  marcado_por           uuid references public.profiles (id) on delete set null,
  canal                 text generated always as (coalesce(canal_marcado, canal_automatico)) stored,
  -- O controle da IA.
  leituras_da_ia        smallint not null default 0,
  ia_pedida_em          timestamptz,
  ia_pedida_ate         timestamptz,
  ia_lida_ate           timestamptz,
  ia_adiada             boolean not null default false,
  fotos_indisponiveis   smallint not null default 0,
  ultima_olhada_em      timestamptz,
  fecha_em              timestamptz not null,
  fechada_em            timestamptz,
  created_at            timestamptz not null default now(),
  constraint chegadas_par_automatico
    check (canal_automatico is null or app.canal_subcanal_valido(canal_automatico, subcanal_automatico)),
  constraint chegadas_par_marcado
    check (canal_marcado is null or app.canal_subcanal_valido(canal_marcado, subcanal_marcado)),
  constraint chegadas_marca_inteira check ((canal_marcado is null) = (marcado_em is null))
);
create index if not exists chegadas_conversa_idx on public.chegadas (conversation_id, inicio_em desc);
create index if not exists chegadas_lendo_idx on public.chegadas (fecha_em) where situacao = 'lendo';
create index if not exists chegadas_inicio_idx on public.chegadas (inicio_em);
alter table public.chegadas enable row level security;
drop policy if exists chegadas_select on public.chegadas;
create policy chegadas_select on public.chegadas
  for select to authenticated using ((select app.conversa_visivel(conversation_id)));
revoke all on public.chegadas from anon;
comment on table public.chegadas is
  'O canal de chegada de cada episódio de conversa que a PESSOA começou (06/11/2026, só Imova). Escrita só por funções: app.chegadas_rodar (pg_cron), app.canal_gravar_da_ia (IA) e public.chegada_marcar (gente, que vence sempre).';

create table if not exists public.chegada_historico (
  id          bigint generated always as identity primary key,
  chegada_id  uuid not null references public.chegadas (id) on delete cascade,
  de          text,
  para        text,
  subcanal    text,
  por_quem    text not null check (por_quem in ('regra', 'ia', 'pessoa', 'sistema')),
  por         uuid references public.profiles (id) on delete set null,
  motivo      text,
  em          timestamptz not null default now()
);
create index if not exists chegada_historico_chegada_idx on public.chegada_historico (chegada_id, em);
alter table public.chegada_historico enable row level security;
drop policy if exists chegada_historico_select on public.chegada_historico;
create policy chegada_historico_select on public.chegada_historico
  for select to authenticated
  using (exists (select 1 from public.chegadas c
                  where c.id = chegada_id and (select app.conversa_visivel(c.conversation_id))));
revoke all on public.chegada_historico from anon;
comment on table public.chegada_historico is
  'Quem mudou o canal de uma chegada, de quê para quê e por quê (regra, IA, pessoa ou o fechamento das 24 h).';

create table if not exists public.canal_padroes (
  id         int generated always as identity primary key,
  slug       text not null unique check (slug ~ '^[a-z0-9_]{2,40}$'),
  canal      text not null check (canal in ('placa', 'anuncios', 'redes_sociais', 'outros')),
  subcanal   text not null,
  -- Expressão regular POSIX sobre app.canal_texto(mensagem): minúsculo e sem acento.
  padrao     text not null check (app.canal_regex_valida(padrao)),
  confianca  numeric(3, 2) not null check (confianca between 0 and 1),
  forte      boolean not null default false,
  posicao    int not null default 0,
  ativo      boolean not null default true,
  -- O começo da frase do motivo ("Mandou o link do ZAP Imóveis").
  frase      text not null check (length(btrim(frase)) between 3 and 80),
  nota       text,
  constraint canal_padroes_par check (app.canal_subcanal_valido(canal, subcanal))
);
alter table public.canal_padroes enable row level security;
drop policy if exists canal_padroes_select on public.canal_padroes;
create policy canal_padroes_select on public.canal_padroes
  for select to authenticated using ((select app.is_manager()));
drop policy if exists canal_padroes_insert on public.canal_padroes;
create policy canal_padroes_insert on public.canal_padroes
  for insert to authenticated with check ((select app.admin_ou_gestor()));
drop policy if exists canal_padroes_update on public.canal_padroes;
create policy canal_padroes_update on public.canal_padroes
  for update to authenticated
  using ((select app.admin_ou_gestor())) with check ((select app.admin_ou_gestor()));
revoke all on public.canal_padroes from anon;
comment on table public.canal_padroes is
  'As palavras e links que dizem o canal sem IA ("vi a placa", link do ZAP). As de partida vêm desta migração (só Imova); admin e gestor podem acrescentar. Desativar em vez de apagar. Um padrão errado rotula errado em silêncio: cada um tem caso no pgTAP 137.';

-- As palavras e links de partida. Procurados no texto minúsculo e sem acento
-- da pessoa. "zap" sozinho NÃO é o portal (no Brasil é o próprio WhatsApp).
-- O TEXTO PRONTO DO ZAP (print do Rafael, 06/11, botão de WhatsApp da
-- página do anúncio): "Olá! Tenho interesse em lote/terreno, <endereço> que
-- encontrei no Zap: https://www.zapimoveis.com.br/imovel/...-id-2900741798/.
-- Código da oferta: TE0002_IMOVA. Código do anúncio no Zap: 2900741798". O
-- link já basta (link_zap); "que encontrei no Zap" cobre quem apaga o link, e
-- o código da oferta vai para chegadas.codigo_do_anuncio. O Viva Real é do
-- mesmo grupo e deve usar o mesmo molde (a confirmar com um clique). A OLX
-- não tem botão de WhatsApp. Cada palavra tem caso no pgTAP 137.
insert into public.canal_padroes (slug, canal, subcanal, padrao, confianca, forte, posicao, ativo, frase, nota) values
  ('texto_do_zap',    'anuncios',      'portal_zap',      'que encontrei no zap\M|codigo do anuncio no zap', 0.97, true, 0, true, 'Veio pelo botão de WhatsApp do ZAP Imóveis', 'O texto pronto do anúncio (print de 06/11/2026)'),
  ('texto_do_vivareal', 'anuncios',    'portal_vivareal', 'que encontrei no viva ?real\M|codigo do anuncio no viva ?real', 0.97, true, 0, true, 'Veio pelo botão de WhatsApp do Viva Real', 'Mesmo molde do ZAP, a confirmar com um clique real'),
  ('link_zap',        'anuncios',      'portal_zap',      'zapimoveis\.com\.br',                    0.95, true,  1, true,  'Mandou o link do ZAP Imóveis', null),
  ('link_vivareal',   'anuncios',      'portal_vivareal', 'vivareal\.com\.br',                      0.95, true,  2, true,  'Mandou o link do Viva Real', null),
  ('link_olx',        'anuncios',      'portal_olx',      'olx\.com\.br',                           0.95, true,  3, true,  'Mandou o link da OLX', null),
  ('fala_zap',        'anuncios',      'portal_zap',      '\mzap ?imoveis\M',                       0.90, true,  4, true,  'Falou do ZAP Imóveis', '"zap" sozinho é o WhatsApp: só conta com "imóveis"'),
  ('fala_vivareal',   'anuncios',      'portal_vivareal', '\mviva ?real\M',                         0.90, true,  5, true,  'Falou do Viva Real', null),
  ('fala_olx',        'anuncios',      'portal_olx',      '\molx\M',                                0.85, false, 7, true,  'Falou da OLX', null),
  ('fala_anuncio',    'anuncios',      'anuncio_outro',   '\m(vi|olhei|achei|encontrei) (o|seu|teu|um|esse|este|aquele) anuncio|\manuncio (de|do|da) (voces|imova)\M', 0.70, false, 8, true, 'Falou de um anúncio', null),
  ('fala_anuncio_na_rede', 'anuncios', 'meta_anuncio', '\manuncio\M.{0,40}\m(insta|instagram|face|facebook)\M|\m(insta|instagram|face|facebook)\M.{0,40}\manuncio\M|\mpatrocinad[oa]\M', 0.80, false, 8, true, 'Falou de anúncio no Instagram ou no Facebook', 'Anúncio na rede é anúncio pago, não Redes sociais (09/11/2026)'),
  ('fala_placa',      'placa',         'texto_da_placa',  '\m(vi|olhei|passei|vendo|achei)\M.{0,25}\mplaca\M|\mplaca (de|da|do) (venda|vende|aluga|aluguel|imova|predio|casa|terreno|apartamento|apto|lote)\M', 0.80, false, 9, true, 'Falou da placa', null),
  ('fala_banner',     'placa',         'texto_da_placa',  '\m(banner|outdoor)\M',                   0.75, false, 10, true, 'Falou do banner', null),
  ('link_instagram',  'redes_sociais', 'instagram',       'instagram\.com/',                        0.85, false, 11, true, 'Mandou um link do Instagram', null),
  ('fala_instagram',  'redes_sociais', 'instagram',       '\m(insta|instagram)\M',                  0.75, false, 12, true, 'Falou do Instagram', null),
  ('fala_facebook',   'redes_sociais', 'facebook',        '\m(face|facebook)\M',                    0.70, false, 13, true, 'Falou do Facebook', null),
  ('fala_tiktok',     'redes_sociais', 'tiktok',          '\mtik ?tok\M',                           0.75, false, 14, true, 'Falou do TikTok', null),
  ('fala_youtube',    'redes_sociais', 'youtube',         '\myoutube\M',                            0.70, false, 15, true, 'Falou do YouTube', null),
  ('fala_indicacao',  'outros',        'indicacao',       '\m(indicou|indicaram|indicacao|indicado|indicada)\M|\mme (passou|passaram|deu|deram) (o |a )?(seu |teu )?(contato|numero)\M', 0.75, false, 16, true, 'Falou de indicação', null)
on conflict (slug) do nothing;

-- O cursor do cron: até onde cada conversa já foi olhada. Fora do PostgREST.
create table if not exists app.canal_vigia (
  conversation_id    uuid primary key references public.conversations (id) on delete cascade,
  olhada_em          timestamptz not null,
  entrada_vista_ate  timestamptz
);
revoke all on app.canal_vigia from public, anon, authenticated;

-- =====================================================================
-- 3. As regras
-- =====================================================================
-- O lead do Canal Pro que clicou no WhatsApp do anúncio. PONTO DE ENCAIXE
-- vazio (mesmo precedente de app.proxima_acao_da_ia): quando a integração de
-- leads do Grupo OLX estiver no ar, uma migração posterior troca o corpo por
-- uma consulta a portal_leads (mesmo telefone, clique entre −24 h e +15 min
-- do início da chegada, CLICK_WHATSAPP primeiro).
create or replace function app.canal_sinal_do_portal(p_conversation_id uuid, p_inicio timestamptz)
returns table (subcanal text, confianca numeric, trecho text, motivo text)
language sql
stable
security definer
set search_path = ''
as $$
  select null::text, null::numeric, null::text, null::text where false
$$;
comment on function app.canal_sinal_do_portal(uuid, timestamptz) is
  'Ponto de encaixe do lead do Canal Pro no canal de chegada. Vazio até a integração de leads do Grupo OLX ir ao ar.';
revoke all on function app.canal_sinal_do_portal(uuid, timestamptz) from public, anon, authenticated;

create or replace function app.canal_dia(p timestamptz)
returns text
language sql
stable
set search_path = ''
as $$
  select to_char(p at time zone 'America/Fortaleza', 'DD/MM')
$$;
revoke all on function app.canal_dia(timestamptz) from public, anon;
grant execute on function app.canal_dia(timestamptz) to authenticated, service_role;

-- A melhor regra para uma chegada, sem gravar. Lê só as mensagens da PESSOA
-- dentro da janela da chegada.
create or replace function app.chegada_regras(p_chegada_id uuid)
returns table (canal text, subcanal text, confianca numeric, forte boolean, regra_slug text,
               evidencias jsonb, motivo text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cfg jsonb := app.canal_de_chegada_config();
  ch    record;
  v_fim timestamptz;
begin
  select c.id, c.conversation_id, c.inicio_em, c.primeira_mensagem_id into ch
    from public.chegadas c where c.id = p_chegada_id;
  if not found then
    return;
  end if;
  v_fim := ch.inicio_em + make_interval(hours => coalesce((v_cfg ->> 'reavaliar_horas')::int, 24));

  return query
  with msgs as (
    select m.id, m.created_at, m.conteudo, m.body,
           app.canal_texto(coalesce(m.body, m.transcript)) as t
      from public.messages m
     where m.conversation_id = ch.conversation_id
       and m.direction = 'in'::app.msg_direction
       and m.type not in ('system'::app.msg_type, 'reaction'::app.msg_type)
       and m.apagada_em is null
       and m.created_at >= ch.inicio_em
       and m.created_at < v_fim
  ), anuncio as (
    select m.id, m.created_at,
           m.conteudo -> 'anuncio' ->> 'tipo' as tipo,
           nullif(btrim(coalesce(m.conteudo -> 'anuncio' ->> 'titulo', '')), '') as titulo,
           nullif(btrim(coalesce(m.conteudo -> 'anuncio' ->> 'corpo', '')), '') as corpo
      from msgs m
     where m.conteudo ? 'anuncio'
       and (m.conteudo -> 'anuncio' ->> 'tipo') in ('ad', 'post')
  ), candidatos as (
    -- 1 e 2. O anúncio da Meta que o webhook já grava. "ad" é anúncio pago
    -- (inclusive post impulsionado com destino WhatsApp); "post" é publicação
    -- ORGÂNICA com o botão do WhatsApp — Redes sociais, como regra fraca até
    -- um caso real confirmar.
    select case when a.tipo = 'ad' then 'anuncios' else 'redes_sociais' end as canal,
           case when a.tipo = 'ad' then 'meta_anuncio' else 'meta_post' end as subcanal,
           (case when a.tipo = 'ad' then 0.99 else 0.80 end)::numeric as confianca,
           (a.tipo = 'ad') as forte,
           ('anuncio_meta_' || a.tipo) as regra_slug,
           jsonb_build_array(jsonb_build_object(
             'message_id', a.id, 'tipo', 'anuncio_meta',
             'trecho', left(coalesce(a.titulo, a.corpo, 'Anúncio sem título'), 160))) as evidencias,
           case when a.tipo = 'ad'
                then 'Clicou no anúncio ' || coalesce('"' || left(a.titulo, 80) || '"', 'do Instagram/Facebook')
                     || ' em ' || app.canal_dia(a.created_at)
                else 'Chamou pelo botão de uma publicação'
                     || coalesce(' ("' || left(a.titulo, 80) || '")', '') || ' em ' || app.canal_dia(a.created_at)
           end as motivo,
           0 as ordem,
           a.created_at
      from anuncio a
    union all
    -- 3. O lead do Canal Pro (ponto de encaixe).
    select 'anuncios', p.subcanal, p.confianca, true, 'canal_pro',
           jsonb_build_array(jsonb_build_object('message_id', ch.primeira_mensagem_id, 'tipo', 'portal',
                                                'trecho', left(coalesce(p.trecho, ''), 160))),
           p.motivo, 1, ch.inicio_em
      from app.canal_sinal_do_portal(ch.conversation_id, ch.inicio_em) p
     where p.subcanal is not null and app.canal_subcanal_valido('anuncios', p.subcanal)
    union all
    -- 4. As palavras e os links.
    select cp.canal, cp.subcanal, cp.confianca, cp.forte, cp.slug,
           jsonb_build_array(jsonb_build_object('message_id', m.id, 'tipo', 'texto',
                                                'trecho', left(btrim(m.body), 160))),
           cp.frase
             || coalesce(' (anúncio ' || substring(m.body from '(?i)c[oó]digo da oferta:\s*([A-Za-z0-9_-]+)') || ')', '')
             || ': "' || left(btrim(regexp_replace(m.body, '\s+', ' ', 'g')), 80)
             || case when length(btrim(m.body)) > 80 then '…' else '' end || '" em ' || app.canal_dia(m.created_at),
           2 + cp.posicao, m.created_at
      from public.canal_padroes cp
      join msgs m on m.t ~ cp.padrao
     where cp.ativo
       and m.body is not null
  )
  select c.canal, c.subcanal, c.confianca, c.forte, c.regra_slug, c.evidencias, c.motivo
    from candidatos c
   -- Entre sinais igualmente fortes, vale o mais antigo: é o primeiro contato.
   order by c.forte desc, c.confianca desc, c.created_at, c.ordem
   limit 1;
end $$;
comment on function app.chegada_regras(uuid) is
  'A melhor regra para uma chegada, sem gravar: anúncio da Meta (messages.conteudo.anuncio), lead do Canal Pro (app.canal_sinal_do_portal) e os padrões de canal_padroes, sobre as mensagens da pessoa na janela da chegada. Só lê.';
revoke all on function app.chegada_regras(uuid) from public, anon, authenticated;

-- =====================================================================
-- 4. Gravar o automático e anotar
-- =====================================================================
create or replace function app.chegada_anotar(p_chegada_id uuid, p_de text, p_para text, p_subcanal text,
                                             p_por_quem text, p_por uuid, p_motivo text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.chegada_historico (chegada_id, de, para, subcanal, por_quem, por, motivo)
  values (p_chegada_id, p_de, p_para, p_subcanal, p_por_quem, p_por, left(p_motivo, 300))
$$;
revoke all on function app.chegada_anotar(uuid, text, text, text, text, uuid, text) from public, anon, authenticated;

create or replace function app.chegada_definir(p_chegada_id uuid, p_canal text, p_subcanal text,
                                              p_confianca numeric, p_decidido_por text, p_regra_slug text,
                                              p_regra_forte boolean, p_evidencias jsonb, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_antes  text;
  v_sub    text;
begin
  select c.canal_automatico, c.subcanal_automatico into v_antes, v_sub
    from public.chegadas c where c.id = p_chegada_id;
  update public.chegadas c
     set canal_automatico    = p_canal,
         subcanal_automatico = p_subcanal,
         confianca           = round(greatest(least(coalesce(p_confianca, 0), 1), 0), 2),
         decidido_por        = p_decidido_por,
         regra_slug          = case when p_decidido_por = 'regra' then p_regra_slug end,
         regra_forte         = coalesce(p_regra_forte, false) and p_decidido_por = 'regra',
         evidencias          = coalesce(p_evidencias, '[]'::jsonb),
         motivo              = left(p_motivo, 300)
   where c.id = p_chegada_id;
  if v_antes is distinct from p_canal or v_sub is distinct from p_subcanal then
    perform app.chegada_anotar(p_chegada_id, v_antes, p_canal, p_subcanal,
                               case when p_decidido_por = 'ia' then 'ia'
                                    when p_regra_slug = 'sem_sinal' then 'sistema' else 'regra' end,
                               null, p_motivo);
  end if;
end $$;
revoke all on function app.chegada_definir(uuid, text, text, numeric, text, text, boolean, jsonb, text)
  from public, anon, authenticated;

-- Pedir a leitura da IA. PONTO DE ENCAIXE: aqui sem IA; a migração
-- 20261109230000_a_ia_le_o_canal troca o corpo pela fila de verdade.
create or replace function app.canal_enfileirar_ia(p_chegada_id uuid, p_lida_ate timestamptz, p_mensagens int)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object('enfileirado', false, 'motivo', 'sem_ia')
$$;
revoke all on function app.canal_enfileirar_ia(uuid, timestamptz, int) from public, anon, authenticated;

-- =====================================================================
-- 5. Olhar uma chegada: regra, pedido à IA e fechamento
-- =====================================================================
create or replace function app.chegada_avaliar(p_chegada_id uuid, p_agora timestamptz default now())
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cfg        jsonb := app.canal_de_chegada_config();
  ch           public.chegadas%rowtype;
  cv           record;
  r            record;
  v_fim        timestamptz;
  v_ult        timestamptz;
  v_n          int;
  v_piloto     jsonb := coalesce(v_cfg -> 'piloto_numeros', '[]'::jsonb);
  v_pode_ia    boolean;
  v_precisa    boolean;
  v_madura     boolean;
  v_fotos_ok   boolean;
  v_ret        jsonb;
  v_feito      text := 'olhada';
begin
  select * into ch from public.chegadas c where c.id = p_chegada_id for update skip locked;
  if not found then
    return 'ocupada';
  end if;
  if ch.situacao = 'fechada' then
    return 'fechada';
  end if;
  select c.peer_phone_e164, c.organization_id, c.contact_id, c.bloqueada_em into cv
    from public.conversations c where c.id = ch.conversation_id;
  v_fim := ch.inicio_em + make_interval(hours => coalesce((v_cfg ->> 'reavaliar_horas')::int, 24));

  -- 1. Regra. A forte toma o lugar da IA e da fraca; a fraca só entra no vazio.
  select * into r from app.chegada_regras(ch.id);
  if r.canal is not null then
    if r.forte and (not ch.regra_forte or ch.canal_automatico is distinct from r.canal
                    or ch.subcanal_automatico is distinct from r.subcanal) then
      perform app.chegada_definir(ch.id, r.canal, r.subcanal, r.confianca, 'regra', r.regra_slug, true,
                                  r.evidencias, r.motivo);
      v_feito := 'regra_forte';
    elsif not r.forte and ch.canal_automatico is null then
      perform app.chegada_definir(ch.id, r.canal, r.subcanal, r.confianca, 'regra', r.regra_slug, false,
                                  r.evidencias, r.motivo);
      v_feito := 'regra_fraca';
    end if;
  end if;
  -- O código do anúncio do texto pronto do portal ("Código da oferta: X").
  if ch.codigo_do_anuncio is null then
    update public.chegadas c
       set codigo_do_anuncio = (
             select substring(m.body from '(?i)c[oó]digo da oferta:\s*([A-Za-z0-9_-]{2,50})')
               from public.messages m
              where m.conversation_id = ch.conversation_id
                and m.direction = 'in'::app.msg_direction
                and m.created_at >= ch.inicio_em and m.created_at < v_fim
                and m.body ~* 'c[oó]digo da oferta:'
              order by m.created_at, m.id
              limit 1)
     where c.id = ch.id;
  end if;
  select * into ch from public.chegadas c where c.id = p_chegada_id;

  -- 2. A IA: sem regra forte, sem marca de gente, abaixo do teto de leituras.
  -- Depois das 24 h só a PRIMEIRA leitura (a chegada antiga, de antes de o
  -- job existir: decisão de 06/11 de valer desde 27/10); releitura, só dentro.
  v_pode_ia := coalesce((v_cfg ->> 'ia')::boolean, false)
               and not ch.regra_forte
               and ch.canal_marcado is null
               and ch.leituras_da_ia < coalesce((v_cfg ->> 'leituras_ia_max')::int, 2)
               and (p_agora < v_fim or ch.leituras_da_ia = 0)
               and cv.bloqueada_em is null
               and (jsonb_array_length(v_piloto) = 0 or v_piloto ? cv.peer_phone_e164)
               and not app.is_suppressed(cv.peer_phone_e164, null, null)
               and not coalesce(app.is_suppressed_target(cv.organization_id, cv.contact_id), false);
  if v_pode_ia then
    select max(m.created_at), count(*)::int into v_ult, v_n
      from public.messages m
     where m.conversation_id = ch.conversation_id
       and m.direction = 'in'::app.msg_direction
       and m.type not in ('system'::app.msg_type, 'reaction'::app.msg_type)
       and m.created_at >= ch.inicio_em and m.created_at < v_fim;

    -- Precisa ler: nunca leu; ou a pessoa escreveu depois da última leitura e
    -- o que vale ainda é fraco (não identificado, confiança baixa, regra fraca).
    v_precisa := v_ult is not null
                 and (ch.ia_lida_ate is null
                      or (v_ult > ch.ia_lida_ate
                          and (ch.canal_automatico = 'nao_identificado'
                               or coalesce(ch.confianca, 0) < coalesce((v_cfg ->> 'releitura_abaixo_de')::numeric, 0.8)
                               or ch.decidido_por = 'regra')))
                 -- E não pediu ainda por estas mesmas mensagens.
                 and (ch.ia_pedida_ate is null or v_ult > ch.ia_pedida_ate);

    -- Madura: a pessoa costuma mandar "Oi", a foto e o texto em sequência.
    v_madura := p_agora >= ch.inicio_em + make_interval(mins => coalesce((v_cfg ->> 'espera_min')::int, 3))
                and (v_ult <= p_agora - make_interval(mins => coalesce((v_cfg ->> 'silencio_min')::int, 2))
                     or p_agora >= greatest(ch.inicio_em, coalesce(ch.ia_lida_ate, ch.inicio_em))
                                   + make_interval(mins => coalesce((v_cfg ->> 'teto_continuo_min')::int, 15)));

    -- As fotos do começo já chegaram (ou desistimos delas).
    v_fotos_ok := not exists (
      select 1
        from public.messages m
        left join public.midia_tentativas t on t.message_id = m.id
       where m.conversation_id = ch.conversation_id
         and m.direction = 'in'::app.msg_direction
         and m.type = 'image'::app.msg_type
         and coalesce(m.tipo_na_meta, 'image') <> 'sticker'
         and m.created_at >= ch.inicio_em
         and m.created_at < ch.inicio_em + make_interval(mins => coalesce((v_cfg ->> 'foto_ate_min')::int, 30))
         and m.media_path is null
         and coalesce(t.tentativas, 0) < 3
         and m.created_at > p_agora - make_interval(mins => coalesce((v_cfg ->> 'foto_desiste_min')::int, 10)));

    if v_precisa and v_madura and v_fotos_ok then
      v_ret := app.canal_enfileirar_ia(ch.id, v_ult, v_n);
      if coalesce((v_ret ->> 'enfileirado')::boolean, false)
         or coalesce((v_ret ->> 'adiado')::boolean, false)
         or v_ret ->> 'motivo' = 'ja_enfileirado' then
        update public.chegadas c
           set ia_pedida_em = p_agora,
               ia_pedida_ate = v_ult,
               ia_adiada = coalesce((v_ret ->> 'adiado')::boolean, false)
         where c.id = ch.id;
        v_feito := case when coalesce((v_ret ->> 'adiado')::boolean, false) then 'ia_adiada' else 'ia_pedida' end;
      end if;
    end if;
  end if;

  -- 3. Fechar em 24 h. Sem sinal, Não identificado. Se a IA pode ler e ainda
  -- não leu nenhuma vez, espera a primeira leitura (até 2 h depois do pedido:
  -- worker parado não segura a chegada aberta para sempre). Orçamento no
  -- limite não espera.
  select * into ch from public.chegadas c where c.id = p_chegada_id;
  if p_agora >= ch.fecha_em
     and not (v_pode_ia and ch.leituras_da_ia = 0 and not ch.ia_adiada
              and (ch.ia_pedida_em is null or p_agora < ch.ia_pedida_em + interval '2 hours')) then
    if ch.canal_automatico is null then
      perform app.chegada_definir(ch.id, 'nao_identificado', 'desconhecido', 0, 'regra', 'sem_sinal', false,
                                  '[]'::jsonb,
                                  case when ch.ia_adiada
                                       then 'Sem sinal nas primeiras 24 h (a IA estava no limite do orçamento)'
                                       else 'Sem sinal nas primeiras 24 h' end);
    end if;
    update public.chegadas c set situacao = 'fechada', fechada_em = p_agora where c.id = ch.id;
    v_feito := 'fechada';
  end if;

  update public.chegadas c set ultima_olhada_em = p_agora where c.id = ch.id;
  return v_feito;
end $$;
comment on function app.chegada_avaliar(uuid, timestamptz) is
  'Olha uma chegada aberta: aplica a regra (a forte toma o lugar da IA e da fraca), pede a leitura da IA quando a janela amadurece e as fotos chegaram, e fecha em 24 h (sem sinal = Não identificado). Nunca toca o que gente marcou. Só lê messages e conversations.';
revoke all on function app.chegada_avaliar(uuid, timestamptz) from public, anon, authenticated;

-- =====================================================================
-- 6. O job: achar episódios novos e olhar os abertos
-- =====================================================================
create or replace function app.chegadas_rodar(p_limite int default 200)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cfg      jsonb := app.canal_de_chegada_config();
  v_lim      int := greatest(coalesce(p_limite, 200), 1);
  v_desde    timestamptz;
  v_dias     int;
  v_internos jsonb;
  r          record;
  v_id       uuid;
  v_ret      text;
  n_conv     int := 0;
  n_novas    int := 0;
  n_olhadas  int := 0;
  n_ins      int;
begin
  if not coalesce((v_cfg ->> 'ligada')::boolean, false) then
    return jsonb_build_object('ligada', false);
  end if;
  -- Duas rodadas nunca se sobrepõem; e nenhuma espera trava de ninguém.
  if not pg_try_advisory_xact_lock(hashtext('app.chegadas_rodar')) then
    return jsonb_build_object('ligada', true, 'ocupado', true);
  end if;
  perform set_config('lock_timeout', '1s', true);

  v_desde := ((v_cfg ->> 'aplicar_desde')::date)::timestamp at time zone 'America/Fortaleza';
  v_dias  := greatest(coalesce((v_cfg ->> 'nova_chegada_apos_dias')::int, 30), 1);
  select coalesce(s.value -> 'ficha' -> 'numeros_internos', '[]'::jsonb) into v_internos
    from public.app_settings s where s.key = 'ia.crm_inteligente';
  v_internos := coalesce(v_internos, '[]'::jsonb);

  -- 6.1 Episódios novos. O que mudou é medido pela hora em que a conversa foi
  -- ESCRITA (`updated_at`, com folga), porque a hora da mensagem é a da Meta e
  -- pode ser anterior à rodada que não a viu; a dedup pela primeira mensagem
  -- (unique) torna a releitura inofensiva.
  for r in
    select c.id, c.last_inbound_at, v.entrada_vista_ate
      from public.conversations c
      left join app.canal_vigia v on v.conversation_id = c.id
     where c.channel = 'whatsapp'::app.channel
       and c.last_inbound_at >= v_desde
       and not (v_internos ? c.peer_phone_e164)
       and (v.conversation_id is null
            or c.last_inbound_at > v.entrada_vista_ate
            or c.updated_at > v.olhada_em - interval '5 minutes')
     order by v.olhada_em nulls first, c.last_inbound_at desc
     limit v_lim
  loop
    insert into public.chegadas (conversation_id, primeira_mensagem_id, inicio_em, fecha_em)
    select r.id, m.id, m.created_at,
           m.created_at + make_interval(hours => coalesce((v_cfg ->> 'reavaliar_horas')::int, 24))
      from public.messages m
     where m.conversation_id = r.id
       and m.direction = 'in'::app.msg_direction
       and m.type not in ('system'::app.msg_type, 'reaction'::app.msg_type)
       and m.created_at >= greatest(v_desde, coalesce(r.entrada_vista_ate - interval '2 days', v_desde))
       -- Começa episódio quem não tem mensagem nenhuma (nossa ou dela) nos
       -- 30 dias antes. A Meta dá a hora em segundos: o "Oi" e a foto do mesmo
       -- segundo desempatam pelo id, e só um começa.
       and not exists (
         select 1 from public.messages p
          where p.conversation_id = m.conversation_id
            and p.type not in ('system'::app.msg_type, 'reaction'::app.msg_type)
            and p.created_at > m.created_at - make_interval(days => v_dias)
            and (p.created_at, p.id) < (m.created_at, m.id))
    on conflict (primeira_mensagem_id) do nothing;
    get diagnostics n_ins = row_count;
    n_novas := n_novas + n_ins;

    insert into app.canal_vigia (conversation_id, olhada_em, entrada_vista_ate)
    values (r.id, now(), r.last_inbound_at)
    on conflict (conversation_id) do update
       set olhada_em = excluded.olhada_em,
           entrada_vista_ate = greatest(app.canal_vigia.entrada_vista_ate, excluded.entrada_vista_ate);
    n_conv := n_conv + 1;
  end loop;

  -- 6.2 As abertas: regra, IA e fechamento.
  for v_id in
    select c.id from public.chegadas c
     where c.situacao = 'lendo'
     order by c.ultima_olhada_em nulls first, c.inicio_em
     limit v_lim * 2
  loop
    begin
      v_ret := app.chegada_avaliar(v_id);
      if v_ret <> 'ocupada' then n_olhadas := n_olhadas + 1; end if;
    exception when others then
      raise warning 'chegada_avaliar(%): %', v_id, sqlerrm;
    end;
  end loop;

  return jsonb_build_object('ligada', true, 'conversas', n_conv, 'chegadas_novas', n_novas,
                            'olhadas', n_olhadas);
end $$;
comment on function app.chegadas_rodar(int) is
  'O job do canal de chegada (pg_cron, a cada minuto, agendado pelo seed da Imova): acha os episódios novos das conversas que mudaram desde aplicar_desde e olha os abertos. Desligado, devolve {"ligada": false} sem ler mais nada. Só LÊ messages e conversations.';
revoke all on function app.chegadas_rodar(int) from public, anon, authenticated;

-- O agendamento de minuto em minuto NÃO é feito aqui: é do seed da Imova
-- (bloco 12g). Na KOMUNE não há job nenhum.

-- =====================================================================
-- 7. A correção de quem atende
-- =====================================================================
create or replace function public.chegada_marcar(p_chegada_id uuid, p_canal text, p_subcanal text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ch    public.chegadas%rowtype;
  v_sub text;
begin
  if not coalesce((app.canal_de_chegada_config() ->> 'ligada')::boolean, false) then
    return jsonb_build_object('ok', false, 'motivo', 'desligada');
  end if;
  select * into ch from public.chegadas c where c.id = p_chegada_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'nao_achada');
  end if;
  if not app.posso_mexer_na_conversa(ch.conversation_id) then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;

  if p_canal is null then
    update public.chegadas c
       set canal_marcado = null, subcanal_marcado = null, marcado_em = null, marcado_por = null
     where c.id = ch.id;
    if ch.canal_marcado is not null then
      perform app.chegada_anotar(ch.id, ch.canal_marcado, ch.canal_automatico, ch.subcanal_automatico,
                                 'pessoa', auth.uid(), 'Voltou para a automática');
    end if;
    return jsonb_build_object('ok', true, 'canal', ch.canal_automatico, 'subcanal', ch.subcanal_automatico,
                              'marcado', false);
  end if;

  if p_canal not in ('placa', 'anuncios', 'redes_sociais', 'outros', 'nao_identificado') then
    return jsonb_build_object('ok', false, 'motivo', 'canal_invalido');
  end if;
  v_sub := coalesce(nullif(btrim(coalesce(p_subcanal, '')), ''),
                    case when ch.canal_automatico = p_canal then ch.subcanal_automatico end,
                    app.canal_subcanal_padrao(p_canal));
  if not app.canal_subcanal_valido(p_canal, v_sub) then
    return jsonb_build_object('ok', false, 'motivo', 'subcanal_invalido');
  end if;

  update public.chegadas c
     set canal_marcado = p_canal, subcanal_marcado = v_sub, marcado_em = now(), marcado_por = auth.uid()
   where c.id = ch.id;
  if ch.canal is distinct from p_canal or coalesce(ch.subcanal_marcado, ch.subcanal_automatico) is distinct from v_sub then
    perform app.chegada_anotar(ch.id, ch.canal, p_canal, v_sub, 'pessoa', auth.uid(),
                               'Corrigido para ' || app.canal_rotulo(p_canal));
  end if;
  return jsonb_build_object('ok', true, 'canal', p_canal, 'subcanal', v_sub, 'marcado', true);
end $$;
comment on function public.chegada_marcar(uuid, text, text) is
  'A correção de quem atende (admin, gestor, SDR — quem pode mexer na conversa): o canal e, opcional, o subcanal; nulo volta para a automática. Vence sempre a regra e a IA. Fica no histórico. Não envia nada.';
revoke all on function public.chegada_marcar(uuid, text, text) from public, anon;
grant execute on function public.chegada_marcar(uuid, text, text) to authenticated;

-- =====================================================================
-- 8. O que a tela lê
-- =====================================================================
create or replace view public.chegadas_na_lista
with (security_invoker = true) as
select c.id,
       c.conversation_id,
       cv.organization_id,
       c.inicio_em,
       c.situacao,
       c.canal,
       case when c.canal_marcado is not null then c.subcanal_marcado else c.subcanal_automatico end as subcanal,
       case when c.canal_marcado is not null then null else c.confianca end as confianca,
       case when c.canal_marcado is not null then 'gente' else c.decidido_por end as decidido_por,
       case when c.canal_marcado is not null
            then 'Corrigido por ' || coalesce(nullif(split_part(btrim(p.full_name), ' ', 1), ''), 'alguém do time')
                 || ' em ' || app.canal_dia(c.marcado_em)
            else c.motivo end as motivo,
       c.regra_slug,
       c.evidencias,
       c.foto,
       c.canal_automatico,
       c.subcanal_automatico,
       c.motivo as motivo_automatico,
       c.decidido_por as decidido_automatico_por,
       c.canal_marcado,
       c.subcanal_marcado,
       c.marcado_em,
       c.marcado_por,
       p.full_name as marcado_por_nome,
       c.sugestao_da_ia,
       c.fechada_em,
       c.codigo_do_anuncio
  from public.chegadas c
  join public.conversations cv on cv.id = c.conversation_id
  left join public.profiles p on p.id = c.marcado_por;
comment on view public.chegadas_na_lista is
  'As chegadas como a tela mostra: o canal que vale (gente vence), o porquê em frase, as provas e o automático por baixo. RLS das tabelas de origem (security_invoker).';
revoke all on public.chegadas_na_lista from anon;
grant select on public.chegadas_na_lista to authenticated;

create or replace view public.canal_por_conversa
with (security_invoker = true) as
select distinct on (l.conversation_id) l.*
  from public.chegadas_na_lista l
 order by l.conversation_id, l.inicio_em desc;
comment on view public.canal_por_conversa is
  'A chegada mais recente de cada conversa: é a etiqueta de Conversas.';
revoke all on public.canal_por_conversa from anon;
grant select on public.canal_por_conversa to authenticated;

  $ddl$;
end $canal$;

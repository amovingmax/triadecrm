-- =====================================================================
-- O relatório que vende, da Imova (09/11/2026)
--
-- Pedido do usuário, sobre os relatórios de 06/11: "Me faça um relatório mais
-- efetivo e que realmente mude e melhore as análises e que impulsione minhas
-- vendas". Depois, sobre o protótipo: "um visual mais analítico e simples de
-- ler", "quantas pessoas estão mais interessadas em um imóvel/terreno
-- específico", "qual o imóvel mais interessado pelos leads", "o lead mais
-- interessado para cada imóvel/terreno", "sugestões da IA para vender mais e
-- pontos a falar ou fazer para cada" e "progresso da IA". Aprovado: "Gostei.
-- Suba esse protótipo na aba de relatórios".
--
-- O QUE ENTRA:
--   1. A carteira (`app.imova_carteira`): os anúncios do CRM e os que só
--      existem no Canal Pro, cada um com a categoria (apartamento, casa,
--      terreno, comercial).
--   2. O interesse de cada lead em cada imóvel (`app.imova_interesses`): o que o
--      CONSELHEIRO (IA, abaixo) leu, mais os sinais certos que já estão no
--      banco — o código citado pelo cliente, a foto do anúncio reconhecida, o
--      lead do portal, a visita que a IA marcou, o imóvel de interesse da ficha.
--   3. O conselheiro de vendas (Haiku 5.5, propósito `aconselhar_vendas`): uma
--      vez por dia lê cada conversa de cliente que mexeu e diz em que imóveis a
--      pessoa está interessada, o perfil dela em números, o que aconteceu e o
--      que a equipe deve falar ou fazer; e lê cada imóvel com interessados e dá
--      três sugestões para vendê-lo. Tudo é para a EQUIPE: nada vai ao cliente.
--      Tabelas `interesse_no_imovel`, `ia_conselho_do_lead`,
--      `ia_conselho_do_imovel`; fila `app.ia_conselheiro_enfileirar`; portas do
--      worker `ia_conselheiro_{lead,imovel}_{entrada,gravar}`.
--   4. A juíza ganha `lacuna` (o que faltou à IA que atende naquele dia).
--   5. As premissas da conta de dinheiro (`relatorio.premissas`: comissão da
--      venda em %, aluguéis na locação, meta do mês), que admin e gestor mudam
--      pela tela.
--   6. As oportunidades paradas agora (`app.imova_mesa_agora`), com a comissão
--      provável = comissão × chance da etapa (histórico de 180 dias puxado para
--      uma referência enquanto há pouco histórico), e a foto diária
--      (`relatorio_imova_mesa_dia`) para o "desde ontem".
--   7. A previsão do mês (`app.imova_previsao`).
--   8. As cinco leituras da tela, cada uma um `jsonb` pronto, com a porteira
--      dos relatórios (`app.sees_all()`):
--        relatorio_imova_painel_visao(de, ate)
--        relatorio_imova_painel_imoveis(de, ate)
--        relatorio_imova_painel_imovel(codigo, de, ate)
--        relatorio_imova_painel_oportunidades()
--        relatorio_imova_painel_funil(de, ate)
--        relatorio_imova_painel_ia()
--      mais relatorio_imova_premissas_salvar(...).
--
-- O WHATSAPP NÃO MUDA. Nada aqui grava mensagem, enfileira envio ou mexe em
-- janela, conversa ou porteira. As leituras só LEEM `messages`.
--
-- SÓ DA IMOVA: no banco da KOMUNE nada é criado (fica só o registro da
-- versão). Num banco sem identidade (CI, db reset) tudo é criado, para os
-- testes. As chaves `ia.conselheiro` e `relatorio.premissas` e os crons moram
-- no seed da Imova (bloco 12k).
-- =====================================================================

do $vende$
declare
  v_def   text;
  v_novo  text;
  v_alvo  regprocedure;
begin
  if (select i.empresa from app.identidade i) = 'komune' then
    raise notice 'O relatório que vende é só da Imova: no banco da KOMUNE nada foi criado.';
    return;
  end if;

  execute $ddl$

-- =====================================================================
-- 1. Tabelas
-- =====================================================================

-- O interesse de um lead num imóvel, como o conselheiro (IA) leu.
create table if not exists public.interesse_no_imovel (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  codigo          text not null check (char_length(codigo) between 1 and 80),
  nivel           text not null check (nivel in ('muito', 'interessado', 'morno')),
  perguntas       text[] not null default '{}',
  primeiro_em     timestamptz not null default now(),
  atualizado_em   timestamptz not null default now(),
  ai_run_id       bigint,
  primary key (conversation_id, codigo)
);
create index if not exists interesse_no_imovel_codigo_idx on public.interesse_no_imovel (codigo);
alter table public.interesse_no_imovel enable row level security;
drop policy if exists interesse_no_imovel_ler on public.interesse_no_imovel;
create policy interesse_no_imovel_ler on public.interesse_no_imovel
  for select to authenticated using (app.sees_all());
comment on table public.interesse_no_imovel is
  'Em que imóvel cada lead da Imova está interessado, e quanto, pela leitura do conselheiro (IA, 09/11/2026). Só o worker escreve, pela porta ia_conselheiro_lead_gravar.';

-- O que o conselheiro disse de cada lead.
create table if not exists public.ia_conselho_do_lead (
  conversation_id     uuid primary key references public.conversations(id) on delete cascade,
  situacao            text check (char_length(situacao) <= 200),
  falar               text check (char_length(falar) <= 240),
  perfil              jsonb not null default '{}'::jsonb,
  dados_insuficientes boolean not null default false,
  ultima_mensagem_em  timestamptz,
  ai_run_id           bigint,
  prompt_version      text,
  atualizado_em       timestamptz not null default now()
);
alter table public.ia_conselho_do_lead enable row level security;
drop policy if exists ia_conselho_do_lead_ler on public.ia_conselho_do_lead;
create policy ia_conselho_do_lead_ler on public.ia_conselho_do_lead
  for select to authenticated using (app.sees_all());
comment on table public.ia_conselho_do_lead is
  'A leitura diária do conselheiro de vendas (IA) para cada lead da Imova (09/11/2026): o que aconteceu, o que a equipe deve falar ou fazer e o perfil em números (finalidade, tipos, bairros, quartos, valor máximo, pagamento). Para a equipe; nada vai ao cliente.';

-- O que o conselheiro sugere para cada imóvel.
create table if not exists public.ia_conselho_do_imovel (
  codigo              text primary key check (char_length(codigo) between 1 and 80),
  sugestoes           jsonb not null default '[]'::jsonb,
  dados_insuficientes boolean not null default false,
  ai_run_id           bigint,
  prompt_version      text,
  atualizado_em       timestamptz not null default now()
);
alter table public.ia_conselho_do_imovel enable row level security;
drop policy if exists ia_conselho_do_imovel_ler on public.ia_conselho_do_imovel;
create policy ia_conselho_do_imovel_ler on public.ia_conselho_do_imovel
  for select to authenticated using (app.sees_all());
comment on table public.ia_conselho_do_imovel is
  'As três sugestões diárias do conselheiro de vendas (IA) para vender cada imóvel da Imova com interessados (09/11/2026): [{tipo: falar|fazer, acao, porque}].';

-- A foto diária das oportunidades paradas (o "desde ontem").
create table if not exists public.relatorio_imova_mesa_dia (
  dia             date primary key,
  valor           numeric not null,
  leads           int not null,
  conversas       uuid[] not null default '{}',
  fotografada_em  timestamptz not null default now()
);
alter table public.relatorio_imova_mesa_dia enable row level security;
drop policy if exists relatorio_imova_mesa_dia_ler on public.relatorio_imova_mesa_dia;
create policy relatorio_imova_mesa_dia_ler on public.relatorio_imova_mesa_dia
  for select to authenticated using (app.sees_all());
comment on table public.relatorio_imova_mesa_dia is
  'A foto de cada noite das oportunidades paradas da Imova (09/11/2026): comissão provável, quantos leads e quais. Serve ao "desde ontem" e à semana do relatório.';

-- O que faltou à IA que atende, na nota da juíza.
alter table public.ia_atendimento_notas add column if not exists lacuna text;
alter table public.ia_atendimento_notas drop constraint if exists ia_atendimento_notas_lacuna_check;
alter table public.ia_atendimento_notas add constraint ia_atendimento_notas_lacuna_check
  check (lacuna is null or lacuna in ('nenhuma', 'condominio_iptu', 'financiamento', 'fotos', 'demorou_visita',
                                      'passou_sem_precisar', 'nao_sabia_do_imovel', 'tom', 'outra'));

-- =====================================================================
-- 2. Peças
-- =====================================================================

-- A categoria do imóvel, do tipo do anúncio (do CRM ou do Canal Pro).
create or replace function app.imova_tipo_categoria(p_tipo text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
           when p_tipo is null then 'outro'
           when lower(p_tipo) ~ '(apart|apto|cobertura|flat|kitnet|studio|loft)' then 'apartamento'
           when lower(p_tipo) ~ '(terreno|lote)' then 'terreno'
           when lower(p_tipo) ~ '(sala|loja|comerc|galp|ponto|predio|prédio|escrit)' then 'comercial'
           when lower(p_tipo) ~ '(casa|sobrado|chal|duplex|village)' then 'casa'
           else 'outro'
         end;
$$;

-- O nível de interesse a partir da atitude (para os sinais sem leitura da IA).
create or replace function app.imova_nivel_da_atitude(p_etiqueta text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_etiqueta when 'muito_interessado' then 'muito' when 'interessado' then 'interessado' else 'morno' end;
$$;

-- Um número de dentro de um jsonb, sem quebrar com texto.
create or replace function app.imova_numero(p_valor text)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case when btrim(coalesce(p_valor, '')) ~ '^-?\d+(\.\d+)?$' then btrim(p_valor)::numeric end;
$$;

-- As premissas da conta de dinheiro e da meta.
create or replace function app.relatorio_imova_premissas()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('comissao_venda_pct', 6, 'alugueis_na_locacao', 1, 'meta_mes', null)
         || coalesce((select s.value from public.app_settings s where s.key = 'relatorio.premissas'), '{}'::jsonb);
$$;

create or replace function app.relatorio_imova_premissas_json()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'comissao_venda_pct', coalesce(app.imova_numero(p ->> 'comissao_venda_pct'), 6),
           'alugueis_na_locacao', coalesce(app.imova_numero(p ->> 'alugueis_na_locacao'), 1),
           'meta_mes', app.imova_numero(p ->> 'meta_mes'),
           'pode_editar', coalesce(app.admin_ou_gestor(), false))
    from (select app.relatorio_imova_premissas() as p) x;
$$;

-- A carteira: os anúncios do CRM (não excluídos, não tirados do ar) e os que só
-- existem no Canal Pro. `chave` é o pedaço do código que o cliente escreve
-- ("te0002" de "TE0002_IMOVA").
create or replace function app.imova_carteira()
returns table (
  codigo text, titulo text, tipo text, tipo_original text, negocio text, bairro text,
  quartos int, area int, preco_venda numeric, preco_aluguel numeric, condominio numeric,
  iptu numeric, descricao text, no_ar_desde timestamptz, onde text, chave text)
language sql
stable
security definer
set search_path = ''
as $$
  select a.codigo, coalesce(nullif(btrim(a.titulo), ''), a.codigo), app.imova_tipo_categoria(a.tipo), a.tipo,
         a.negocio, a.bairro, a.quartos::int, coalesce(a.area_util, a.area_total),
         a.preco_venda::numeric, a.preco_aluguel::numeric, a.condominio::numeric, a.iptu::numeric,
         left(a.descricao, 600), coalesce(a.publicado_em, a.criado_em), 'CRM',
         lower(extensions.unaccent(split_part(a.codigo, '_', 1)))
    from public.anuncios a
   where a.excluido_em is null and a.saiu_do_ar_em is null
  union all
  select m.codigo, coalesce(nullif(btrim(m.titulo), ''), m.codigo), app.imova_tipo_categoria(coalesce(m.tipo_crm, m.tipo)),
         coalesce(m.tipo_crm, m.tipo), m.negocio, m.bairro, m.quartos::int, m.area,
         m.preco_venda::numeric, m.preco_aluguel::numeric, null::numeric, null::numeric, null::text,
         coalesce(case when app.canal_pro_campo(m.linha, array['criacao', 'data de criacao']) ~ '^\d{2}-\d{2}-\d{4}'
                       then to_date(left(app.canal_pro_campo(m.linha, array['criacao', 'data de criacao']), 10), 'DD-MM-YYYY')::timestamp
                            at time zone 'America/Fortaleza' end,
                  m.visto_em),
         'Canal Pro', lower(extensions.unaccent(split_part(m.codigo, '_', 1)))
    from public.anuncios_no_canal_pro m
   where m.anuncio_id is null and m.excluido_em is null and m.marcado_excluido_em is null
     and not exists (select 1 from public.anuncios a where a.codigo = m.codigo and a.excluido_em is null);
$$;

-- Os leads de agora: os CLIENTES em conversa (proprietário é captação e fica
-- de fora), sem a conversa do treino, sem concluída, bloqueada, suprimida, sem
-- interesse ou negócio encerrado. Com o calor (a mesma conta dos clientes
-- quentes de 06/11), a etapa, a próxima visita e o que o conselheiro disse.
create or replace function app.imova_leads_agora()
returns table (
  conversation_id uuid, organization_id uuid, nome text, etiqueta text, antes_de_esfriar text,
  atitude_desde timestamptz, score_intencao smallint, criada_em timestamptz,
  ultima_do_cliente timestamptz, ultima_da_equipe timestamptz, dono_id uuid, dono text,
  deal_id uuid, etapa_slug text, etapa text, na_etapa_desde timestamptz, proxima_acao_em timestamptz,
  proxima_visita timestamptz, calor int, dados_extraidos jsonb,
  finalidade text, valor_max numeric, perfil jsonb,
  conselho_situacao text, conselho_falar text, conselho_em timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  with base as (
    select c.id as conversation_id, c.organization_id, c.created_at, c.last_inbound_at, c.last_outbound_at,
           c.assignee_id, c.deal_id,
           coalesce(nullif(btrim(o.name), ''), nullif(btrim(c.peer_nome), ''), 'Sem nome') as nome,
           a.etiqueta, a.antes_de_esfriar, a.desde,
           f.score_intencao, f.dados_extraidos
      from public.conversations c
      left join public.organizations o on o.id = c.organization_id
      left join public.atitudes a on a.conversation_id = c.id
      left join public.ficha_da_conversa f on f.conversation_id = c.id
     where c.id is distinct from app.ia_conversa_de_treino()
       and c.arquivada_em is null
       and c.bloqueada_em is null
       and c.last_inbound_at is not null
       and (o.id is null or (o.kind::text <> 'fornecedor' and o.deleted_at is null and not coalesce(o.do_not_contact, false)))
       and coalesce(a.etiqueta, '') not in ('sem_interesse', 'nao_contatar')
       and not app.is_suppressed(c.peer_phone_e164, null, null)
  ),
  com_negocio as (
    select b.*, d.id as negocio_id, d.entered_stage_at, d.next_action_at, s.slug as etapa_slug, s.name as etapa_nome,
           coalesce(s.is_won, false) or coalesce(s.is_lost, false) or coalesce(s.is_optout, false) as encerrado
      from base b
      left join lateral (
        select d.* from public.deals d
         where (b.deal_id is not null and d.id = b.deal_id)
            or (b.deal_id is null and b.organization_id is not null and d.organization_id = b.organization_id)
         order by (d.id = b.deal_id) desc nulls last, d.updated_at desc
         limit 1) d on true
      left join public.stages s on s.id = d.stage_id
  ),
  calculado as (
    select n.*,
           (select min(r.inicio) from public.reunioes r
             where (r.conversation_id = n.conversation_id
                    or (n.organization_id is not null and r.organization_id = n.organization_id))
               and r.inicio > now()
               and r.estado in ('a_confirmar', 'marcada', 'confirmada')) as proxima_visita,
           case n.etiqueta
             when 'muito_interessado' then 90
             when 'interessado'       then 60
             when 'morno'             then 40
             when 'esfriando'         then case n.antes_de_esfriar when 'muito_interessado' then 45 else 30 end
             when 'sem_resposta'      then 15
           end as peso
      from com_negocio n
     where not n.encerrado
  )
  select k.conversation_id, k.organization_id, k.nome, k.etiqueta, k.antes_de_esfriar, k.desde,
         k.score_intencao, k.created_at, k.last_inbound_at, k.last_outbound_at, k.assignee_id, p.full_name,
         k.negocio_id, k.etapa_slug, k.etapa_nome, k.entered_stage_at, k.next_action_at, k.proxima_visita,
         least(100, greatest(0,
           case when k.score_intencao is null then coalesce(k.peso, 0)
                when k.peso is null then k.score_intencao
                else round((k.peso + k.score_intencao) / 2.0)::int end
           + case when k.last_inbound_at >= now() - interval '1 day' then 10
                  when k.last_inbound_at >= now() - interval '3 days' then 6
                  when k.last_inbound_at >= now() - interval '7 days' then 3
                  else 0 end
           + case when k.proxima_visita is not null then 10 else 0 end))::int,
         coalesce(k.dados_extraidos, '{}'::jsonb),
         case when cl.perfil ->> 'finalidade' in ('compra', 'locacao') then cl.perfil ->> 'finalidade'
              when lower(coalesce(k.dados_extraidos -> 'finalidade' ->> 'valor', '')) ~ '(alug|loca)' then 'locacao'
              when lower(coalesce(k.dados_extraidos -> 'finalidade' ->> 'valor', '')) ~ '(compr|venda)' then 'compra'
         end,
         app.imova_numero(cl.perfil ->> 'valor_max'),
         coalesce(cl.perfil, '{}'::jsonb),
         cl.situacao, cl.falar, cl.atualizado_em
    from calculado k
    left join public.profiles p on p.id = k.assignee_id
    left join public.ia_conselho_do_lead cl on cl.conversation_id = k.conversation_id;
$$;

-- O interesse de cada lead em cada imóvel da carteira: o que o conselheiro leu
-- e, onde ele não leu, os sinais certos do banco (180 dias). Uma linha por
-- lead × imóvel, com o nível mais alto e de onde veio.
create or replace function app.imova_interesses()
returns table (conversation_id uuid, codigo text, nivel text, perguntas text[], origem text, primeiro_em timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  with leads as (
    select l.conversation_id, l.organization_id, l.etiqueta from app.imova_leads_agora() l
  ),
  cart as (
    select c.codigo, c.chave from app.imova_carteira() c
  ),
  ia as (
    select i.conversation_id, i.codigo, i.nivel, i.perguntas, 'ia'::text as origem, i.primeiro_em
      from public.interesse_no_imovel i
      join leads l on l.conversation_id = i.conversation_id
      join cart k on k.codigo = i.codigo
  ),
  sinais as (
    select m.conversation_id, k.codigo, 'codigo_na_mensagem'::text as origem, min(m.created_at) as em
      from public.messages m
      join leads l on l.conversation_id = m.conversation_id
      join cart k on char_length(k.chave) >= 4
                 and strpos(lower(extensions.unaccent(coalesce(m.body, ''))), k.chave) > 0
     where m.direction = 'in'::app.msg_direction
       and m.created_at >= now() - interval '180 days'
     group by 1, 2
    union all
    select f.conversation_id, f.codigo, 'foto', min(f.criada_em)
      from public.ia_fotos_reconhecidas f
      join leads l on l.conversation_id = f.conversation_id
      join cart k on k.codigo = f.codigo
     where f.certeza in ('alta', 'media')
     group by 1, 2
    union all
    select pl.conversation_id, coalesce(a.codigo, mm.codigo), 'portal', min(pl.recebido_em)
      from public.portal_leads pl
      join leads l on l.conversation_id = pl.conversation_id
      left join public.anuncios a on a.id = pl.anuncio_id
      left join public.anuncios_no_canal_pro mm on mm.id = pl.anuncio_no_canal_pro_id
     where coalesce(a.codigo, mm.codigo) in (select k.codigo from cart k)
     group by 1, 2
    union all
    select q.conversation_id, q.detalhes ->> 'imovel', 'visita', min(q.criada_em)
      from public.ia_respostas q
      join leads l on l.conversation_id = q.conversation_id
     where q.acao = 'marcou_visita'
       and q.detalhes ->> 'imovel' in (select k.codigo from cart k)
     group by 1, 2
    union all
    select fc.conversation_id, k.codigo, 'ficha', min(fc.updated_at)
      from public.ficha_da_conversa fc
      join leads l on l.conversation_id = fc.conversation_id
      join cart k on char_length(k.chave) >= 4
                 and strpos(lower(extensions.unaccent(coalesce(fc.dados_extraidos -> 'imovel_de_interesse' ->> 'valor', ''))), k.chave) > 0
     group by 1, 2
  ),
  dos_sinais as (
    select s.conversation_id, s.codigo,
           case when bool_or(s.origem = 'visita') then 'muito'
                else app.imova_nivel_da_atitude(min(l.etiqueta)) end as nivel,
           '{}'::text[] as perguntas,
           string_agg(distinct s.origem, ',') as origem,
           min(s.em) as primeiro_em
      from sinais s
      join leads l on l.conversation_id = s.conversation_id
     where not exists (select 1 from ia i where i.conversation_id = s.conversation_id and i.codigo = s.codigo)
     group by 1, 2
  )
  select * from ia
  union all
  select * from dos_sinais;
$$;

-- A chance de cada etapa do funil de clientes virar negócio: o histórico de
-- 180 dias (só negócios resolvidos ou com mais de 30 dias na etapa), puxado
-- para uma referência de mercado com peso de 10 negócios. Com pouco histórico,
-- vale a referência; com muito, o histórico.
create or replace function app.imova_chances()
returns table (etapa_slug text, chance numeric)
language sql
stable
security definer
set search_path = ''
as $$
  with ref(slug, p) as (
    values ('identificado', 0.02), ('contatado', 0.02), ('respondeu', 0.05), ('demonstracao_marcada', 0.10),
           ('demonstracao_realizada', 0.17), ('parceria_aceita', 0.44), ('nutricao', 0.02)
  ),
  hist as (
    select s.slug, count(distinct h.deal_id) as n,
           count(distinct h.deal_id) filter (where d.won_at is not null) as g
      from public.deal_stage_history h
      join public.stages s on s.id = h.to_stage_id
      join public.pipelines pp on pp.id = s.pipeline_id and pp.slug = 'produtor'
      join public.deals d on d.id = h.deal_id
     where h.changed_at >= now() - interval '180 days'
       and (d.won_at is not null or d.lost_at is not null or h.changed_at < now() - interval '30 days')
     group by 1
  )
  select r.slug, round((coalesce(h.g, 0) + r.p * 10)::numeric / (coalesce(h.n, 0) + 10), 4)
    from ref r left join hist h on h.slug = r.slug;
$$;

-- =====================================================================
-- 3. As oportunidades paradas agora
-- =====================================================================
-- Uma linha por lead × situação. A comissão provável = (valor do imóvel ×
-- comissão da venda, ou aluguel × aluguéis da locação) × chance da etapa.
-- O valor é o do imóvel daquela linha (o que combina, ou o de maior interesse);
-- sem imóvel, o teto que o lead disse (perfil do conselheiro).
create or replace function app.imova_mesa_agora()
returns table (
  conversation_id uuid, nome text, calor int, nivel text, codigo text, imovel text,
  situacao text, ordem int, desde timestamptz, porque text, fazer text, fazer_da_ia boolean,
  venda numeric, aluguel numeric, valor numeric, chance numeric, dono_id uuid, dono text)
language sql
stable
security definer
set search_path = ''
as $$
  with l as (select * from app.imova_leads_agora()),
  prem as (
    select coalesce(app.imova_numero(p ->> 'comissao_venda_pct'), 6) / 100.0 as pct,
           coalesce(app.imova_numero(p ->> 'alugueis_na_locacao'), 1) as alug
      from (select app.relatorio_imova_premissas() as p) x
  ),
  ch as (select * from app.imova_chances()),
  cart as (select * from app.imova_carteira()),
  intr as (select * from app.imova_interesses()),
  melhor_intr as (
    select distinct on (i.conversation_id) i.conversation_id, i.codigo
      from intr i
     order by i.conversation_id,
              case i.nivel when 'muito' then 1 when 'interessado' then 2 else 3 end,
              i.primeiro_em desc
  ),
  sit as (
    select l.conversation_id, 'esperando'::text as situacao, 1 as ordem, l.ultima_do_cliente as desde,
           'Escreveu e ninguém respondeu.'::text as porque, 'Responder agora.'::text as padrao, null::text as cod
      from l
     where l.etiqueta in ('muito_interessado', 'interessado')
       and l.ultima_do_cliente > coalesce(l.ultima_da_equipe, '-infinity'::timestamptz)
       and l.ultima_do_cliente < now() - interval '30 minutes'
    union all
    select l.conversation_id, 'promessa', 2, p.prazo, 'Prometido: ' || p.o_que, 'Cumprir hoje: ' || p.o_que, null
      from l
      join lateral (
        select cc.prazo, cc.o_que from public.compromissos_da_conversa cc
         where cc.conversation_id = l.conversation_id and cc.quem = 'equipe'
           and cc.status in ('aberto', 'vencido') and cc.prazo < now()
         order by cc.prazo limit 1) p on true
    union all
    select l.conversation_id, 'proposta', 3, greatest(l.na_etapa_desde, l.ultima_do_cliente),
           'Recebeu a proposta e não respondeu.', 'Ligar e perguntar o que falta para fechar.', null
      from l
     where l.etapa_slug = 'parceria_aceita'
       and coalesce(l.na_etapa_desde, '-infinity'::timestamptz) < now() - interval '3 days'
       and coalesce(l.ultima_do_cliente, '-infinity'::timestamptz) < now() - interval '3 days'
    union all
    select l.conversation_id, 'visita', 4, v.fim,
           'Visitou em ' || to_char(v.inicio at time zone 'America/Fortaleza', 'DD/MM') || ' e ninguém voltou a falar.',
           'Perguntar o que achou e propor o próximo passo.', null
      from l
      join lateral (
        select r.inicio, r.fim from public.reunioes r
         where (r.conversation_id = l.conversation_id
                or (l.organization_id is not null and r.organization_id = l.organization_id))
           and r.estado in ('realizada', 'marcada', 'confirmada')
           and r.fim < now() - interval '24 hours' and r.fim > now() - interval '21 days'
         order by r.fim desc limit 1) v on true
     where not exists (
       select 1 from public.messages m
        where m.conversation_id = l.conversation_id and m.direction = 'out'::app.msg_direction
          and m.author_kind in ('human', 'bot_ai') and m.created_at > v.fim)
    union all
    select l.conversation_id, 'combina', 5,
           greatest(k.no_ar_desde, l.conselho_em),
           'Combina com o ' || k.codigo || ' e não recebeu.', 'Mandar o ' || k.codigo || '.', k.codigo
      from l
      join lateral (
        select k.* from cart k
         where l.finalidade is not null and l.valor_max is not null
           and jsonb_typeof(l.perfil -> 'tipos') = 'array' and jsonb_array_length(l.perfil -> 'tipos') > 0
           and k.tipo in (select jsonb_array_elements_text(l.perfil -> 'tipos'))
           and case l.finalidade
                 when 'compra'  then k.preco_venda is not null and k.preco_venda <= l.valor_max * 1.1
                 when 'locacao' then k.preco_aluguel is not null and k.preco_aluguel <= l.valor_max * 1.1
                 else false end
           and (jsonb_typeof(l.perfil -> 'bairros') is distinct from 'array'
                or jsonb_array_length(l.perfil -> 'bairros') = 0
                or exists (select 1 from jsonb_array_elements_text(l.perfil -> 'bairros') b
                            where lower(extensions.unaccent(b)) = lower(extensions.unaccent(coalesce(k.bairro, '')))))
           and (app.imova_numero(l.perfil ->> 'quartos_min') is null
                or coalesce(k.quartos, 0) >= app.imova_numero(l.perfil ->> 'quartos_min'))
           and not exists (select 1 from intr i where i.conversation_id = l.conversation_id and i.codigo = k.codigo)
           and not exists (
             select 1 from public.messages m
              where m.conversation_id = l.conversation_id and m.direction = 'out'::app.msg_direction
                and char_length(k.chave) >= 4
                and strpos(lower(extensions.unaccent(coalesce(m.body, ''))), k.chave) > 0)
         order by abs(coalesce(case l.finalidade when 'compra' then k.preco_venda else k.preco_aluguel end, 0) - l.valor_max)
         limit 1) k on true
     where l.ultima_do_cliente >= now() - interval '30 days'
    union all
    select l.conversation_id, 'esfriando', 6, l.atitude_desde,
           'Era ' || case l.antes_de_esfriar when 'muito_interessado' then 'muito interessado' else 'interessado' end
             || ' e parou de responder.',
           'Reativar com um imóvel novo ou uma condição nova.', null
      from l
     where l.etiqueta = 'esfriando' and l.antes_de_esfriar in ('muito_interessado', 'interessado')
  ),
  com_imovel as (
    select s.*, coalesce(s.cod, mi.codigo) as codigo_final
      from sit s
      left join melhor_intr mi on mi.conversation_id = s.conversation_id
  )
  select s.conversation_id, l.nome, l.calor,
         case l.etiqueta when 'muito_interessado' then 'muito' when 'interessado' then 'interessado'
                         when 'morno' then 'morno' when 'esfriando' then 'morno' end,
         s.codigo_final, k.titulo,
         s.situacao, s.ordem, s.desde, s.porque,
         coalesce(case when s.situacao <> 'combina' then l.conselho_falar end, s.padrao),
         l.conselho_falar is not null and s.situacao <> 'combina',
         v.venda, v.aluguel,
         round((coalesce(v.venda, 0) * prem.pct + coalesce(v.aluguel, 0) * prem.alug)
               * coalesce(cx.chance, cr.chance, 0.05), 2),
         coalesce(cx.chance, cr.chance, 0.05),
         l.dono_id, l.dono
    from com_imovel s
    join l on l.conversation_id = s.conversation_id
    cross join prem
    left join cart k on k.codigo = s.codigo_final
    left join ch cx on cx.etapa_slug = l.etapa_slug
    left join ch cr on cr.etapa_slug = 'respondeu'
    cross join lateral (
      select case when k.codigo is not null then
                    case when (l.finalidade = 'locacao' or k.preco_venda is null) then null else k.preco_venda end
                  when l.finalidade = 'compra' then l.valor_max end as venda,
             case when k.codigo is not null then
                    case when (l.finalidade = 'locacao' or k.preco_venda is null) then k.preco_aluguel end
                  when l.finalidade = 'locacao' then l.valor_max end as aluguel) v;
$$;

-- A foto da noite (cron do seed da Imova, 23h50 de Natal).
create or replace function app.relatorio_imova_fotografar_mesa()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dia    date := (now() at time zone 'America/Fortaleza')::date;
  v_valor  numeric;
  v_leads  int;
  v_ids    uuid[];
begin
  with m as (select * from app.imova_mesa_agora()),
       por_lead as (select m.conversation_id, max(m.valor) as valor from m group by 1)
  select coalesce(sum(p.valor), 0), count(*), coalesce(array_agg(p.conversation_id), '{}')
    into v_valor, v_leads, v_ids
    from por_lead p;
  insert into public.relatorio_imova_mesa_dia (dia, valor, leads, conversas, fotografada_em)
  values (v_dia, v_valor, v_leads, v_ids, now())
  on conflict (dia) do update
     set valor = excluded.valor, leads = excluded.leads, conversas = excluded.conversas,
         fotografada_em = excluded.fotografada_em;
  return jsonb_build_object('dia', v_dia, 'valor', v_valor, 'leads', v_leads);
end $$;

-- =====================================================================
-- 4. A previsão do mês
-- =====================================================================
-- Fechados no mês + negócios abertos × chance de fechar até o fim do mês. A
-- chance de fechar em D dias: a fração dos negócios que entraram na etapa nos
-- últimos 180 dias e fecharam em até D dias, puxada para uma referência de 30
-- dias (proporcional a D) com peso de 8 negócios. A faixa é ± um desvio da
-- soma de sorteios (p × (1 − p)).
create or replace function app.imova_previsao()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_hoje   date := (now() at time zone 'America/Fortaleza')::date;
  v_mes    date := date_trunc('month', v_hoje)::date;
  v_prox   date := (date_trunc('month', v_hoje) + interval '1 month')::date;
  v_dias   int := (v_prox - v_hoje);
  v_ini    timestamptz := (v_mes::timestamp at time zone 'America/Fortaleza');
  v_fim    timestamptz := (v_prox::timestamp at time zone 'America/Fortaleza');
  v_fech   int;
  v_etapas jsonb;
  v_esp    numeric;
  v_var    numeric;
  v_real   int;
  v_falt   int;
  v_ganh   int;
  v_marc   int;
  v_meta   numeric := app.imova_numero(app.relatorio_imova_premissas() ->> 'meta_mes');
begin
  select count(*) into v_fech
    from public.deals d
    join public.pipelines p on p.id = d.pipeline_id and p.slug = 'produtor'
   where d.won_at >= v_ini and d.won_at < v_fim;

  with ref(slug, nome, posicao, p30) as (
    values ('respondeu', 'Conversando', 1, 0.01), ('demonstracao_marcada', 'Visita marcada', 2, 0.04),
           ('demonstracao_realizada', 'Visita feita', 3, 0.09), ('parceria_aceita', 'Proposta', 4, 0.38)
  ),
  abertos as (
    select s.slug, count(*) as n
      from public.deals d
      join public.stages s on s.id = d.stage_id
      join public.pipelines p on p.id = d.pipeline_id and p.slug = 'produtor'
     where d.won_at is null and d.lost_at is null
       and not coalesce(s.is_won, false) and not coalesce(s.is_lost, false)
     group by 1
  ),
  hist as (
    select s.slug, count(distinct h.deal_id) as n,
           count(distinct h.deal_id) filter (where d.won_at is not null and d.won_at <= h.changed_at + make_interval(days => v_dias)) as g
      from public.deal_stage_history h
      join public.stages s on s.id = h.to_stage_id
      join public.pipelines p on p.id = s.pipeline_id and p.slug = 'produtor'
      join public.deals d on d.id = h.deal_id
     where h.changed_at >= now() - interval '180 days'
       and h.changed_at < now() - make_interval(days => v_dias)
     group by 1
  ),
  linhas as (
    select r.nome, r.posicao, coalesce(a.n, 0) as abertos,
           round(least(1, (coalesce(h.g, 0) + least(1, r.p30 * v_dias / 30.0) * 8)
                          / (coalesce(h.n, 0) + 8.0)), 4) as chance
      from ref r
      left join abertos a on a.slug = r.slug
      left join hist h on h.slug = r.slug
  )
  select jsonb_agg(jsonb_build_object('etapa', x.nome, 'abertos', x.abertos, 'chance', x.chance,
                                      'esperado', round(x.abertos * x.chance, 2)) order by x.posicao desc),
         coalesce(sum(x.abertos * x.chance), 0),
         coalesce(sum(x.abertos * x.chance * (1 - x.chance)), 0)
    into v_etapas, v_esp, v_var
    from linhas x;

  select count(*) filter (where r.estado = 'realizada'),
         count(*) filter (where r.estado = 'nao_compareceu')
    into v_real, v_falt
    from public.reunioes r
   where r.inicio >= now() - interval '90 days' and r.inicio < now();
  select count(*) into v_ganh
    from public.deals d join public.pipelines p on p.id = d.pipeline_id and p.slug = 'produtor'
   where d.won_at >= now() - interval '90 days';
  select count(*) into v_marc
    from public.reunioes r
   where r.criada_em >= now() - interval '28 days' and r.estado not in ('cancelada');

  return jsonb_build_object(
    'mes', to_char(v_mes, 'YYYY-MM'),
    'dias_restantes', v_dias,
    'fechados', v_fech,
    'esperado', round(v_fech + v_esp, 1),
    'faixa_baixa', round(greatest(v_fech, v_fech + v_esp - sqrt(v_var)), 1),
    'faixa_alta', round(v_fech + v_esp + sqrt(v_var), 1),
    'meta', v_meta,
    'por_etapa', coalesce(v_etapas, '[]'::jsonb),
    'ritmo', jsonb_build_object(
      'visitas_por_negocio', case when v_ganh > 0 then round(v_real::numeric / v_ganh, 1) end,
      'comparecimento', case when v_real + v_falt > 0 then round(v_real::numeric / (v_real + v_falt), 2) end,
      'visitas_marcadas_por_semana', round(v_marc / 4.0, 1)));
end $$;

-- =====================================================================
-- 5. O ranking dos imóveis
-- =====================================================================
-- Os imóveis da carteira com os leads interessados (de agora, que falaram no
-- período), por nível, e o lead mais quente de cada um.
create or replace function app.imova_ranking_imoveis(p_de timestamptz, p_fim timestamptz)
returns table (
  codigo text, titulo text, tipo text, negocio text, bairro text, preco_venda numeric, preco_aluguel numeric,
  dias_no_ar int, muito int, interessado int, morno int, total int,
  lider_conversation_id uuid, lider_nome text, lider_calor int)
language sql
stable
security definer
set search_path = ''
as $$
  with cart as (select * from app.imova_carteira()),
  l as (select * from app.imova_leads_agora()),
  i as (
    select x.conversation_id, x.codigo, x.nivel, l.nome, l.calor
      from app.imova_interesses() x
      join l on l.conversation_id = x.conversation_id
     where l.ultima_do_cliente >= p_de and l.ultima_do_cliente < p_fim
  ),
  agg as (
    select i.codigo,
           count(*) filter (where i.nivel = 'muito')::int as muito,
           count(*) filter (where i.nivel = 'interessado')::int as interessado,
           count(*) filter (where i.nivel = 'morno')::int as morno
      from i group by 1
  ),
  lider as (
    select distinct on (i.codigo) i.codigo, i.conversation_id, i.nome, i.calor
      from i order by i.codigo, i.calor desc, i.nome
  )
  select k.codigo, k.titulo, k.tipo,
         case when k.preco_venda is not null and k.preco_aluguel is not null then 'venda_e_aluguel'
              when k.negocio in ('venda', 'aluguel') then k.negocio
              when k.preco_venda is not null then 'venda'
              when k.preco_aluguel is not null then 'aluguel' end,
         k.bairro, k.preco_venda, k.preco_aluguel,
         case when k.no_ar_desde is not null
              then ((now() at time zone 'America/Fortaleza')::date - (k.no_ar_desde at time zone 'America/Fortaleza')::date) end,
         coalesce(a.muito, 0), coalesce(a.interessado, 0), coalesce(a.morno, 0),
         coalesce(a.muito, 0) + coalesce(a.interessado, 0) + coalesce(a.morno, 0),
         ld.conversation_id, ld.nome, ld.calor
    from cart k
    left join agg a on a.codigo = k.codigo
    left join lider ld on ld.codigo = k.codigo;
$$;

create or replace function app.imova_linha_imovel_json(r jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'codigo', r -> 'codigo', 'titulo', r -> 'titulo', 'tipo', r -> 'tipo', 'negocio', r -> 'negocio',
    'bairro', r -> 'bairro', 'preco_venda', r -> 'preco_venda', 'preco_aluguel', r -> 'preco_aluguel',
    'dias_no_ar', r -> 'dias_no_ar', 'muito', r -> 'muito', 'interessado', r -> 'interessado',
    'morno', r -> 'morno', 'total', r -> 'total',
    'lider', case when jsonb_typeof(r -> 'lider_conversation_id') is distinct from 'string' then null
                  else jsonb_build_object('conversation_id', r -> 'lider_conversation_id', 'nome', r -> 'lider_nome',
                                          'calor', r -> 'lider_calor') end);
$$;

-- =====================================================================
-- 6. O funil do período (eventos), comum à Visão geral e ao Funil
-- =====================================================================
-- Leads novos (conversa de cliente criada), conversaram (primeira resposta da
-- equipe ou da IA), visita marcada (reunião criada), visita feita (reunião
-- realizada), proposta (entrou em Proposta) e fechado (ganho), no período.
create or replace function app.imova_funil_periodo(p_de timestamptz, p_fim timestamptz)
returns table (posicao int, etapa text, leads int)
language sql
stable
security definer
set search_path = ''
as $$
  with clientes as (
    select c.id, c.created_at, c.organization_id
      from public.conversations c
      left join public.organizations o on o.id = c.organization_id
     where c.id is distinct from app.ia_conversa_de_treino()
       and c.last_inbound_at is not null
       and (o.id is null or o.kind::text <> 'fornecedor')
  )
  select 1, 'Leads novos', (select count(*) from clientes c where c.created_at >= p_de and c.created_at < p_fim)::int
  union all
  select 2, 'Conversaram', (
    select count(*) from clientes c
     where c.created_at >= p_de and c.created_at < p_fim
       and exists (select 1 from public.messages m
                    where m.conversation_id = c.id and m.direction = 'out'::app.msg_direction
                      and m.author_kind in ('human', 'bot_ai')))::int
  union all
  select 3, 'Visita marcada', (
    select count(distinct coalesce(r.conversation_id::text, r.organization_id::text, r.id::text))
      from public.reunioes r
     where r.criada_em >= p_de and r.criada_em < p_fim and r.estado <> 'cancelada')::int
  union all
  select 4, 'Visita feita', (
    select count(distinct coalesce(r.conversation_id::text, r.organization_id::text, r.id::text))
      from public.reunioes r
     where r.inicio >= p_de and r.inicio < p_fim and r.estado = 'realizada')::int
  union all
  select 5, 'Proposta', (
    select count(distinct h.deal_id)
      from public.deal_stage_history h
      join public.stages s on s.id = h.to_stage_id and s.slug = 'parceria_aceita'
      join public.pipelines p on p.id = s.pipeline_id and p.slug = 'produtor'
     where h.changed_at >= p_de and h.changed_at < p_fim)::int
  union all
  select 6, 'Negócio fechado', (
    select count(*) from public.deals d
      join public.pipelines p on p.id = d.pipeline_id and p.slug = 'produtor'
     where d.won_at >= p_de and d.won_at < p_fim)::int;
$$;

-- A primeira resposta (equipe ou IA) de cada lead novo, em minutos.
create or replace function app.imova_primeiras_respostas(p_de timestamptz, p_fim timestamptz)
returns table (conversation_id uuid, criada_em timestamptz, minutos numeric, por_quem uuid, pela_ia boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.created_at,
         round(extract(epoch from (r.created_at - pi.created_at)) / 60.0, 1),
         r.sent_by, r.author_kind = 'bot_ai'
    from public.conversations c
    left join public.organizations o on o.id = c.organization_id
    join lateral (select m.created_at from public.messages m
                   where m.conversation_id = c.id and m.direction = 'in'::app.msg_direction
                   order by m.created_at limit 1) pi on true
    left join lateral (select m.created_at, m.sent_by, m.author_kind from public.messages m
                        where m.conversation_id = c.id and m.direction = 'out'::app.msg_direction
                          and m.author_kind in ('human', 'bot_ai') and m.created_at >= pi.created_at
                        order by m.created_at limit 1) r on true
   where c.created_at >= p_de and c.created_at < p_fim
     and c.id is distinct from app.ia_conversa_de_treino()
     and (o.id is null or o.kind::text <> 'fornecedor');
$$;

-- =====================================================================
-- 7. A IA que atende, semana a semana
-- =====================================================================
create or replace function app.imova_ia_semanas()
returns table (
  inicio date, conversas int, duvida numeric, informacao numeric, satisfacao numeric,
  subiu_pct numeric, igual_pct numeric, caiu_pct numeric, resolvidas_pct numeric, visitas int)
language sql
stable
security definer
set search_path = ''
as $$
  with treino as (select app.ia_conversa_de_treino() as id),
  resp as (
    select q.conversation_id, q.acao,
           date_trunc('week', q.criada_em at time zone 'America/Fortaleza')::date as semana
      from public.ia_respostas q
     where q.conversation_id is distinct from (select id from treino)
  ),
  primeira as (select min(r.semana) as s from resp r),
  semanas as (
    select g::date as inicio
      from primeira p,
           generate_series(greatest(p.s, date_trunc('week', (now() at time zone 'America/Fortaleza'))::date - 77),
                           date_trunc('week', (now() at time zone 'America/Fortaleza'))::date, interval '7 days') g
     where p.s is not null
  ),
  conv as (
    select r.semana, r.conversation_id,
           bool_or(r.acao in ('respondeu', 'marcou_visita')) as falou,
           bool_or(r.acao = 'passou_para_pessoa') as passou
      from resp r group by 1, 2
  ),
  notas as (
    select date_trunc('week', n.dia)::date as semana, n.duvida, n.informacao, n.satisfacao, n.interesse
      from public.ia_atendimento_notas n
     where n.conversation_id is distinct from (select id from treino)
  )
  select s.inicio,
         (select count(*) from conv c where c.semana = s.inicio and c.falou)::int,
         (select round(avg(n.duvida), 2) from notas n where n.semana = s.inicio),
         (select round(avg(n.informacao), 2) from notas n where n.semana = s.inicio),
         (select round(avg(n.satisfacao), 2) from notas n where n.semana = s.inicio),
         (select round(100.0 * count(*) filter (where n.interesse = 'subiu') / nullif(count(n.interesse), 0), 1) from notas n where n.semana = s.inicio),
         (select round(100.0 * count(*) filter (where n.interesse = 'igual') / nullif(count(n.interesse), 0), 1) from notas n where n.semana = s.inicio),
         (select round(100.0 * count(*) filter (where n.interesse = 'caiu') / nullif(count(n.interesse), 0), 1) from notas n where n.semana = s.inicio),
         (select round(100.0 * count(*) filter (where c.falou and not c.passou) / nullif(count(*) filter (where c.falou), 0), 1)
            from conv c where c.semana = s.inicio),
         (select count(*) from public.reunioes r
           where r.marcada_por = 'robo' and r.conversation_id is distinct from (select id from treino)
             and date_trunc('week', r.criada_em at time zone 'America/Fortaleza')::date = s.inicio)::int
    from semanas s
   order by s.inicio;
$$;

-- =====================================================================
-- 8. O conselheiro de vendas (IA): configuração, fila e portas do worker
-- =====================================================================
create or replace function app.ia_conselheiro_config()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('ligada', false, 'dias_para_tras', 30, 'por_rodada', 150)
         || coalesce((select s.value from public.app_settings s where s.key = 'ia.conselheiro'), '{}'::jsonb)
         || case when (select i.empresa from app.identidade i) is distinct from 'imova'
                 then jsonb_build_object('ligada', false) else '{}'::jsonb end;
$$;

-- A fila (cron do seed da Imova): 'lead' = cada lead que teve mensagem depois
-- da última leitura do conselheiro, nos últimos `dias_para_tras`; 'imovel' =
-- cada imóvel da carteira com interessado, uma vez por dia. A chave da fila
-- (conversa:hora da última mensagem; código:dia) faz pedir duas vezes não
-- pagar duas vezes.
create or replace function app.ia_conselheiro_enfileirar(p_alvo text default 'lead')
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cfg    jsonb := app.ia_conselheiro_config();
  v_dias   int := greatest(least(coalesce((v_cfg ->> 'dias_para_tras')::int, 30), 90), 1);
  v_limite int := greatest(least(coalesce((v_cfg ->> 'por_rodada')::int, 150), 1000), 1);
  v_hoje   date := (now() at time zone 'America/Fortaleza')::date;
  v_res    jsonb;
  v_n      int := 0;
  r        record;
begin
  if not coalesce((v_cfg ->> 'ligada')::boolean, false) then
    return 0;
  end if;
  if p_alvo = 'lead' then
    for r in
      select l.conversation_id, greatest(l.ultima_do_cliente, l.ultima_da_equipe) as ultima
        from app.imova_leads_agora() l
       where greatest(l.ultima_do_cliente, l.ultima_da_equipe) >= now() - make_interval(days => v_dias)
         and (l.conselho_em is null
              or l.conselho_em < greatest(l.ultima_do_cliente, l.ultima_da_equipe))
       order by greatest(l.ultima_do_cliente, l.ultima_da_equipe) desc
       limit v_limite
    loop
      v_res := app.ia_enfileirar('aconselhar_vendas',
                                 jsonb_build_object('alvo', 'lead', 'conversation_id', r.conversation_id),
                                 'lead:' || r.conversation_id::text || ':' || to_char(r.ultima, 'YYYYMMDDHH24MISS'));
      if coalesce((v_res ->> 'enfileirado')::boolean, false) then v_n := v_n + 1; end if;
    end loop;
  elsif p_alvo = 'imovel' then
    for r in
      select distinct i.codigo
        from app.imova_interesses() i
       order by i.codigo
       limit v_limite
    loop
      v_res := app.ia_enfileirar('aconselhar_vendas',
                                 jsonb_build_object('alvo', 'imovel', 'codigo', r.codigo),
                                 'imovel:' || r.codigo || ':' || v_hoje::text);
      if coalesce((v_res ->> 'enfileirado')::boolean, false) then v_n := v_n + 1; end if;
    end loop;
  else
    raise exception 'alvo do conselheiro desconhecido: %', p_alvo using errcode = '22023';
  end if;
  return v_n;
end $$;
comment on function app.ia_conselheiro_enfileirar(text) is
  'A fila do conselheiro de vendas da Imova (09/11/2026): ''lead'' = leads com mensagem depois da última leitura; ''imovel'' = imóveis com interessado, uma vez por dia. Chamada pelos crons do seed da Imova.';

-- Telefones e e-mails saem do texto que vai ao modelo.
create or replace function app.imova_sem_contato(p_texto text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(
           regexp_replace(coalesce(p_texto, ''), '[\w.+-]+@[\w-]+\.[\w.-]+', '[e-mail]', 'g'),
           '\+?\d[\d\s().-]{7,}\d', '[telefone]', 'g');
$$;

create or replace function public.ia_conselheiro_lead_entrada(p_conversation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_l     record;
  v_ficha jsonb;
begin
  select * into v_l from app.imova_leads_agora() l where l.conversation_id = p_conversation_id;
  if not found then
    return null;
  end if;

  select jsonb_build_object(
           'resumo', f.resumo, 'intencao', f.intencao, 'score', f.score_intencao, 'motivo', f.motivo,
           'objecoes', coalesce((select jsonb_agg(distinct ob.nome)
                                   from public.conversa_objecoes co join public.objecoes ob on ob.id = co.objecao_id
                                  where co.conversation_id = p_conversation_id and co.resolvida_em is null), '[]'::jsonb),
           'perfil', coalesce((select jsonb_object_agg(e.key, e.value ->> 'valor')
                                 from jsonb_each(coalesce(f.dados_extraidos, '{}'::jsonb)) e
                                where jsonb_typeof(e.value) = 'object' and nullif(e.value ->> 'valor', '') is not null), '{}'::jsonb),
           'proxima_acao', f.proxima_acao)
    into v_ficha
    from public.ficha_da_conversa f where f.conversation_id = p_conversation_id;

  return jsonb_build_object(
    'agora', to_char(now() at time zone 'America/Fortaleza', 'YYYY-MM-DD HH24:MI'),
    'conversa', jsonb_build_object(
      'quem', case when v_l.organization_id is null then 'Sem ficha' else 'Cliente' end,
      'atitude', v_l.etiqueta, 'antes_de_esfriar', v_l.antes_de_esfriar, 'etapa', v_l.etapa,
      'visita_marcada', to_char(v_l.proxima_visita at time zone 'America/Fortaleza', 'DD/MM HH24:MI'),
      'dono', split_part(coalesce(v_l.dono, ''), ' ', 1)),
    'ficha', v_ficha,
    'sinais', coalesce((select jsonb_agg(jsonb_build_object('codigo', i.codigo, 'origem', split_part(i.origem, ',', 1)))
                          from app.imova_interesses() i
                         where i.conversation_id = p_conversation_id and i.origem <> 'ia'), '[]'::jsonb),
    'carteira', coalesce((select jsonb_agg(jsonb_build_object(
                                   'codigo', k.codigo, 'titulo', k.titulo, 'tipo', k.tipo,
                                   'negocio', case when k.preco_venda is not null and k.preco_aluguel is not null then 'venda_e_aluguel'
                                                   else coalesce(k.negocio, case when k.preco_venda is not null then 'venda' else 'aluguel' end) end,
                                   'bairro', k.bairro, 'quartos', k.quartos, 'area', k.area,
                                   'preco_venda', k.preco_venda, 'preco_aluguel', k.preco_aluguel,
                                   'condominio', k.condominio) order by k.codigo)
                            from app.imova_carteira() k), '[]'::jsonb),
    'compromissos_abertos', coalesce((select jsonb_agg(jsonb_build_object(
                                               'quem', cc.quem, 'o_que', cc.o_que,
                                               'prazo', to_char(cc.prazo at time zone 'America/Fortaleza', 'DD/MM HH24:MI'))
                                             order by cc.prazo nulls last)
                                        from public.compromissos_da_conversa cc
                                       where cc.conversation_id = p_conversation_id and cc.status in ('aberto', 'vencido')),
                                     '[]'::jsonb),
    'mensagens', coalesce((select jsonb_agg(jsonb_build_object('de', x.de, 'quando', x.quando, 'texto', x.texto) order by x.created_at)
                             from (select m.created_at,
                                          case when m.direction = 'in'::app.msg_direction then 'cliente'
                                               when m.author_kind = 'bot_ai' then 'ia'
                                               when m.author_kind = 'human' then 'equipe'
                                               else 'automatica' end as de,
                                          to_char(m.created_at at time zone 'America/Fortaleza', 'DD/MM HH24:MI') as quando,
                                          left(app.imova_sem_contato(coalesce(nullif(btrim(m.body), ''), m.transcript,
                                               '[' || m.type::text || ']')), 600) as texto
                                     from public.messages m
                                    where m.conversation_id = p_conversation_id and m.apagada_em is null
                                    order by m.created_at desc
                                    limit 40) x), '[]'::jsonb));
end $$;
comment on function public.ia_conselheiro_lead_entrada(uuid) is
  'Porta de leitura do conselheiro de vendas (Imova, 09/11/2026): o lead, a ficha, os sinais de imóvel, a carteira, os compromissos abertos e as 40 últimas mensagens, sem telefone nem e-mail. Nula quando a conversa não é um lead de agora.';

create or replace function public.ia_conselheiro_lead_gravar(
  p_conversation_id uuid, p_saida jsonb, p_ai_run_id bigint default null, p_prompt_version text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_perfil jsonb;
  v_ultima timestamptz;
  v_n      int := 0;
begin
  if not exists (select 1 from public.conversations c where c.id = p_conversation_id) then
    return jsonb_build_object('ok', false, 'motivo', 'conversa_nao_existe');
  end if;
  if p_saida is null or jsonb_typeof(p_saida) <> 'object' then
    return jsonb_build_object('ok', false, 'motivo', 'saida_invalida');
  end if;
  select max(m.created_at) into v_ultima from public.messages m where m.conversation_id = p_conversation_id;

  v_perfil := jsonb_strip_nulls(jsonb_build_object(
    'finalidade', case when p_saida -> 'perfil' ->> 'finalidade' in ('compra', 'locacao') then p_saida -> 'perfil' ->> 'finalidade' end,
    'tipos', (select coalesce(jsonb_agg(distinct t), '[]'::jsonb)
                from jsonb_array_elements_text(case when jsonb_typeof(p_saida -> 'perfil' -> 'tipos') = 'array'
                                                    then p_saida -> 'perfil' -> 'tipos' else '[]'::jsonb end) t
               where t in ('apartamento', 'casa', 'terreno', 'comercial', 'outro')),
    'bairros', (select coalesce(jsonb_agg(left(btrim(b), 60)), '[]'::jsonb)
                  from (select b from jsonb_array_elements_text(case when jsonb_typeof(p_saida -> 'perfil' -> 'bairros') = 'array'
                                                                     then p_saida -> 'perfil' -> 'bairros' else '[]'::jsonb end) b
                         where btrim(b) <> '' limit 6) x),
    'quartos_min', case when (p_saida -> 'perfil' ->> 'quartos_min') ~ '^\d{1,2}$' then (p_saida -> 'perfil' ->> 'quartos_min')::int end,
    'valor_max', case when app.imova_numero(p_saida -> 'perfil' ->> 'valor_max') > 0 then app.imova_numero(p_saida -> 'perfil' ->> 'valor_max') end,
    'pagamento', case when p_saida -> 'perfil' ->> 'pagamento' in ('financiamento', 'a_vista', 'fgts', 'consorcio', 'misto')
                      then p_saida -> 'perfil' ->> 'pagamento' end));

  insert into public.ia_conselho_do_lead as c (
    conversation_id, situacao, falar, perfil, dados_insuficientes, ultima_mensagem_em, ai_run_id, prompt_version, atualizado_em)
  values (
    p_conversation_id,
    left(nullif(btrim(coalesce(p_saida ->> 'situacao', '')), ''), 200),
    left(nullif(btrim(coalesce(p_saida ->> 'falar', '')), ''), 240),
    v_perfil,
    coalesce((p_saida ->> 'dadosInsuficientes')::boolean, false),
    v_ultima, p_ai_run_id, left(p_prompt_version, 80), now())
  on conflict (conversation_id) do update
     set situacao = excluded.situacao, falar = excluded.falar, perfil = excluded.perfil,
         dados_insuficientes = excluded.dados_insuficientes, ultima_mensagem_em = excluded.ultima_mensagem_em,
         ai_run_id = excluded.ai_run_id, prompt_version = excluded.prompt_version, atualizado_em = excluded.atualizado_em;

  -- Os imóveis: só os da carteira (até 3); os que saíram da leitura saem da tabela.
  with lidos as (
    select x, ordinality as ordem
      from jsonb_array_elements(case when jsonb_typeof(p_saida -> 'imoveis') = 'array'
                                     then p_saida -> 'imoveis' else '[]'::jsonb end) with ordinality as t(x, ordinality)
  ),
  validos as (
    select distinct on (l.x ->> 'codigo') l.x ->> 'codigo' as codigo, l.x ->> 'nivel' as nivel,
           coalesce((select array_agg(left(btrim(q), 40)) from (
                       select q from jsonb_array_elements_text(case when jsonb_typeof(l.x -> 'perguntas') = 'array'
                                                                    then l.x -> 'perguntas' else '[]'::jsonb end) q
                        where btrim(q) <> '' limit 5) y), '{}'::text[]) as perguntas,
           l.ordem
      from lidos l
     where l.x ->> 'nivel' in ('muito', 'interessado', 'morno')
       and exists (select 1 from app.imova_carteira() k where k.codigo = l.x ->> 'codigo')
     order by l.x ->> 'codigo', l.ordem
  ),
  novos as (select v.* from validos v order by v.ordem limit 3),
  apagados as (
    delete from public.interesse_no_imovel i
     where i.conversation_id = p_conversation_id
       and i.codigo not in (select n.codigo from novos n)
    returning 1
  )
  insert into public.interesse_no_imovel as i (conversation_id, codigo, nivel, perguntas, primeiro_em, atualizado_em, ai_run_id)
  select p_conversation_id, n.codigo, n.nivel, n.perguntas, now(), now(), p_ai_run_id
    from novos n
  on conflict (conversation_id, codigo) do update
     set nivel = excluded.nivel, perguntas = excluded.perguntas, atualizado_em = excluded.atualizado_em,
         ai_run_id = excluded.ai_run_id;
  get diagnostics v_n = row_count;

  return jsonb_build_object('ok', true, 'imoveis', v_n);
end $$;
comment on function public.ia_conselheiro_lead_gravar(uuid, jsonb, bigint, text) is
  'Porta de escrita do conselheiro de vendas (Imova, 09/11/2026): grava a leitura do lead e troca os imóveis em que ele está interessado (só códigos da carteira; até 3).';

create or replace function public.ia_conselheiro_imovel_entrada(p_codigo text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_k      record;
  v_fim    timestamptz := now();
  v_de     timestamptz := now() - interval '30 days';
begin
  select * into v_k from app.imova_carteira() k where k.codigo = p_codigo;
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'agora', to_char(now() at time zone 'America/Fortaleza', 'YYYY-MM-DD HH24:MI'),
    'imovel', jsonb_build_object(
      'codigo', v_k.codigo, 'titulo', v_k.titulo, 'tipo', v_k.tipo, 'negocio', v_k.negocio, 'bairro', v_k.bairro,
      'quartos', v_k.quartos, 'area', v_k.area, 'preco_venda', v_k.preco_venda, 'preco_aluguel', v_k.preco_aluguel,
      'condominio', v_k.condominio, 'iptu', v_k.iptu,
      'dias_no_ar', case when v_k.no_ar_desde is not null then ((now() at time zone 'America/Fortaleza')::date - (v_k.no_ar_desde at time zone 'America/Fortaleza')::date) end,
      'descricao', app.imova_sem_contato(v_k.descricao)),
    'numeros', app.imova_numeros_do_imovel(p_codigo, v_de, v_fim),
    'leads', coalesce((select jsonb_agg(jsonb_build_object(
                                 'nivel', i.nivel, 'situacao', l.conselho_situacao, 'perguntas', to_jsonb(i.perguntas),
                                 'objecoes', coalesce((select jsonb_agg(distinct ob.nome)
                                                         from public.conversa_objecoes co join public.objecoes ob on ob.id = co.objecao_id
                                                        where co.conversation_id = i.conversation_id), '[]'::jsonb),
                                 'valor_max', l.valor_max, 'pagamento', l.perfil ->> 'pagamento')
                               order by case i.nivel when 'muito' then 1 when 'interessado' then 2 else 3 end, l.calor desc)
                         from (select * from app.imova_interesses() x where x.codigo = p_codigo limit 20) i
                         join app.imova_leads_agora() l on l.conversation_id = i.conversation_id), '[]'::jsonb),
    'perguntas_top', app.imova_perguntas_do_imovel(p_codigo),
    'objecoes_top', app.imova_objecoes_do_imovel(p_codigo));
end $$;

create or replace function public.ia_conselheiro_imovel_gravar(
  p_codigo text, p_saida jsonb, p_ai_run_id bigint default null, p_prompt_version text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_sug jsonb;
begin
  if not exists (select 1 from app.imova_carteira() k where k.codigo = p_codigo) then
    return jsonb_build_object('ok', false, 'motivo', 'imovel_nao_existe');
  end if;
  if p_saida is null or jsonb_typeof(p_saida) <> 'object' then
    return jsonb_build_object('ok', false, 'motivo', 'saida_invalida');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('tipo', s ->> 'tipo', 'acao', left(btrim(s ->> 'acao'), 120),
                                               'porque', left(btrim(coalesce(s ->> 'porque', '')), 200))), '[]'::jsonb)
    into v_sug
    from (select s from jsonb_array_elements(case when jsonb_typeof(p_saida -> 'sugestoes') = 'array'
                                                  then p_saida -> 'sugestoes' else '[]'::jsonb end) s
           where s ->> 'tipo' in ('falar', 'fazer') and btrim(coalesce(s ->> 'acao', '')) <> ''
           limit 3) x;
  insert into public.ia_conselho_do_imovel as c (codigo, sugestoes, dados_insuficientes, ai_run_id, prompt_version, atualizado_em)
  values (p_codigo, v_sug, coalesce((p_saida ->> 'dadosInsuficientes')::boolean, false), p_ai_run_id,
          left(p_prompt_version, 80), now())
  on conflict (codigo) do update
     set sugestoes = excluded.sugestoes, dados_insuficientes = excluded.dados_insuficientes,
         ai_run_id = excluded.ai_run_id, prompt_version = excluded.prompt_version, atualizado_em = excluded.atualizado_em;
  return jsonb_build_object('ok', true, 'sugestoes', jsonb_array_length(v_sug));
end $$;

-- Os números de um imóvel no período: visualizações e contatos do Canal Pro
-- (diferença entre fotos), interessados de agora, visitas e propostas deles.
create or replace function app.imova_numeros_do_imovel(p_codigo text, p_de timestamptz, p_fim timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with fim as (select f.visualizacoes, f.contatos from public.canal_pro_fotos f
                where f.codigo = p_codigo and f.em < p_fim order by f.em desc, f.id desc limit 1),
       ini as (select f.visualizacoes, f.contatos from public.canal_pro_fotos f
                where f.codigo = p_codigo and f.em < p_de order by f.em desc, f.id desc limit 1),
       i as (select x.conversation_id, x.nivel from app.imova_interesses() x where x.codigo = p_codigo),
       l as (select l.* from app.imova_leads_agora() l join i on i.conversation_id = l.conversation_id)
  select jsonb_build_object(
    'visualizacoes', (select case when ini.visualizacoes is not null then greatest(fim.visualizacoes - ini.visualizacoes, 0)
                                  else fim.visualizacoes end from fim left join ini on true),
    'contatos', (select case when ini.contatos is not null then greatest(fim.contatos - ini.contatos, 0)
                             else fim.contatos end from fim left join ini on true),
    'interessados', (select count(*) from i)::int,
    'muito', (select count(*) from i where i.nivel = 'muito')::int,
    'visitas', (select count(distinct r.id) from public.reunioes r join l
                  on (r.conversation_id = l.conversation_id or (l.organization_id is not null and r.organization_id = l.organization_id))
                 where r.estado <> 'cancelada' and r.criada_em >= p_de and r.criada_em < p_fim)::int,
    'propostas', (select count(distinct l.deal_id) from l
                   where l.deal_id is not null
                     and exists (select 1 from public.deal_stage_history h join public.stages s on s.id = h.to_stage_id
                                  where h.deal_id = l.deal_id and s.slug = 'parceria_aceita'))::int);
$$;

create or replace function app.imova_perguntas_do_imovel(p_codigo text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('tema', x.tema, 'leads', x.n) order by x.n desc, x.tema), '[]'::jsonb)
    from (select lower(btrim(q)) as tema, count(distinct i.conversation_id)::int as n
            from app.imova_interesses() i, unnest(i.perguntas) q
           where i.codigo = p_codigo and btrim(q) <> ''
           group by 1 order by 2 desc, 1 limit 6) x;
$$;

create or replace function app.imova_objecoes_do_imovel(p_codigo text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('objecao', x.nome, 'leads', x.n) order by x.n desc, x.nome), '[]'::jsonb)
    from (select ob.nome, count(distinct i.conversation_id)::int as n
            from app.imova_interesses() i
            join public.conversa_objecoes co on co.conversation_id = i.conversation_id
            join public.objecoes ob on ob.id = co.objecao_id
           where i.codigo = p_codigo
           group by 1 order by 2 desc, 1 limit 5) x;
$$;

-- =====================================================================
-- 9. A juíza grava a lacuna
-- =====================================================================
create or replace function public.ia_juiza_gravar(
  p_conversation_id uuid, p_dia date, p_saida jsonb,
  p_ai_run_id bigint default null, p_prompt_version text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_ini  timestamptz := (p_dia::timestamp at time zone 'America/Fortaleza');
  v_fim  timestamptz := ((p_dia + 1)::timestamp at time zone 'America/Fortaleza');
  v_n    int;
begin
  if not exists (select 1 from public.conversations c where c.id = p_conversation_id) then
    return jsonb_build_object('ok', false, 'motivo', 'conversa_nao_existe');
  end if;
  select count(*) into v_n
    from public.ia_respostas q
   where q.conversation_id = p_conversation_id and q.message_id is not null
     and q.criada_em >= v_ini and q.criada_em < v_fim;

  insert into public.ia_atendimento_notas as n (
    conversation_id, dia, respostas, duvida, informacao, satisfacao, interesse,
    porque, melhorar, lacuna, dados_insuficientes, ai_run_id, prompt_version, criada_em)
  values (
    p_conversation_id, p_dia, v_n,
    case when (p_saida ->> 'duvida') ~ '^[1-5]$' then (p_saida ->> 'duvida')::smallint end,
    case when (p_saida ->> 'informacao') ~ '^[1-5]$' then (p_saida ->> 'informacao')::smallint end,
    case when (p_saida ->> 'satisfacao') ~ '^[1-5]$' then (p_saida ->> 'satisfacao')::smallint end,
    case when p_saida ->> 'interesse' in ('subiu', 'igual', 'caiu') then p_saida ->> 'interesse' end,
    left(nullif(btrim(coalesce(p_saida ->> 'porque', '')), ''), 400),
    left(nullif(btrim(coalesce(p_saida ->> 'melhorar', '')), ''), 300),
    case when p_saida ->> 'lacuna' in ('nenhuma', 'condominio_iptu', 'financiamento', 'fotos', 'demorou_visita',
                                       'passou_sem_precisar', 'nao_sabia_do_imovel', 'tom', 'outra')
         then p_saida ->> 'lacuna' end,
    coalesce((p_saida ->> 'dadosInsuficientes')::boolean, false),
    p_ai_run_id, left(p_prompt_version, 80), now())
  on conflict (conversation_id, dia) do update
     set respostas = excluded.respostas, duvida = excluded.duvida, informacao = excluded.informacao,
         satisfacao = excluded.satisfacao, interesse = excluded.interesse, porque = excluded.porque,
         melhorar = excluded.melhorar, lacuna = excluded.lacuna, dados_insuficientes = excluded.dados_insuficientes,
         ai_run_id = excluded.ai_run_id, prompt_version = excluded.prompt_version,
         criada_em = excluded.criada_em;
  return jsonb_build_object('ok', true, 'respostas', v_n);
end $$;
comment on function public.ia_juiza_gravar(uuid, date, jsonb, bigint, text) is
  'Porta de escrita da IA juíza (Imova, 06/11/2026; lacuna desde 09/11): grava a nota do dia da conversa. Nota fora de 1 a 5 vira nula; lacuna fora da lista vira nula; a mesma conversa e dia regravados trocam a nota.';

-- =====================================================================
-- 10. As leituras da tela
-- =====================================================================

-- 10.1 Oportunidades (agora)
create or replace function public.relatorio_imova_painel_oportunidades()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_hoje     date := (now() at time zone 'America/Fortaleza')::date;
  v_ont_val  numeric;
  v_ont_lds  int;
  v_ont_ids  uuid[];
  v_res      jsonb;
begin
  perform app.relatorio_imova_porteira();

  select d.valor, d.leads, d.conversas into v_ont_val, v_ont_lds, v_ont_ids
    from public.relatorio_imova_mesa_dia d where d.dia < v_hoje order by d.dia desc limit 1;

  with m as (select * from app.imova_mesa_agora()),
  um as (
    select distinct on (m.conversation_id) m.*
      from m order by m.conversation_id, m.ordem
  ),
  total as (
    select coalesce(sum(x.v), 0) as valor, count(*) as leads
      from (select m.conversation_id, max(coalesce(m.valor, 0)) as v from m group by 1) x
  )
  select jsonb_build_object(
    'atualizado_em', now(),
    'premissas', app.relatorio_imova_premissas_json(),
    'valor', (select t.valor from total t),
    'valor_ontem', v_ont_val,
    'leads', (select t.leads from total t),
    'leads_ontem', v_ont_lds,
    'resolvidas_ontem', case when v_ont_ids is not null then
                          (select count(*) from unnest(v_ont_ids) c
                            where not exists (select 1 from m where m.conversation_id = c)) end,
    'mais_antiga', (select jsonb_build_object('nome', u.nome,
                                              'dias', ((now() at time zone 'America/Fortaleza')::date - (u.desde at time zone 'America/Fortaleza')::date),
                                              'situacao', u.situacao)
                      from um u where u.desde is not null and u.situacao <> 'combina' order by u.desde limit 1),
    'situacoes', coalesce((select jsonb_agg(jsonb_build_object(
                                   'situacao', s.situacao, 'leads', s.leads, 'valor', s.valor, 'venda', s.venda,
                                   'aluguel', s.aluguel, 'chance', s.chance) order by s.valor desc, s.ordem)
                             from (select m.situacao, min(m.ordem) as ordem, count(distinct m.conversation_id)::int as leads,
                                          round(coalesce(sum(m.valor), 0), 2) as valor,
                                          coalesce(sum(m.venda), 0) as venda, coalesce(sum(m.aluguel), 0) as aluguel,
                                          round(avg(m.chance), 4) as chance
                                     from m group by 1) s), '[]'::jsonb),
    'fila', coalesce((select jsonb_agg(jsonb_build_object(
                              'conversation_id', u.conversation_id,
                              'organization_id', (select c.organization_id from public.conversations c where c.id = u.conversation_id),
                              'nome', u.nome, 'calor', u.calor, 'nivel', u.nivel,
                              'codigo', u.codigo, 'imovel', u.imovel, 'situacao', u.situacao, 'desde', u.desde,
                              'porque', u.porque, 'fazer', u.fazer, 'fazer_da_ia', u.fazer_da_ia,
                              'valor', u.valor, 'chance', u.chance, 'dono', u.dono)
                            order by (u.situacao = 'esperando') desc,
                                     case when u.situacao = 'esperando' then extract(epoch from u.desde) end asc nulls last,
                                     u.valor desc nulls last, u.calor desc)
                       from (select * from um order by (um.situacao = 'esperando') desc,
                                                      case when um.situacao = 'esperando' then extract(epoch from um.desde) end asc nulls last,
                                                      um.valor desc nulls last, um.calor desc limit 60) u), '[]'::jsonb),
    'donos', coalesce((select jsonb_agg(jsonb_build_object('dono', d.dono, 'leads', d.leads, 'valor', d.valor)
                                        order by d.valor desc, d.leads desc)
                         from (select x.dono, count(*)::int as leads, round(coalesce(sum(x.v), 0), 2) as valor
                                 from (select m.conversation_id, max(m.dono) as dono, max(coalesce(m.valor, 0)) as v
                                         from m group by 1) x
                                group by 1) d), '[]'::jsonb))
  into v_res;
  return v_res;
end $$;

-- 10.2 Imóveis (ranking) e o detalhe de um imóvel
create or replace function public.relatorio_imova_painel_imoveis(p_de date default null, p_ate date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_hoje date := (now() at time zone 'America/Fortaleza')::date;
  v_ate  date := coalesce(p_ate, v_hoje);
  v_dei  date := coalesce(p_de, v_ate - 29);
  v_de   timestamptz := (v_dei::timestamp at time zone 'America/Fortaleza');
  v_fim  timestamptz := ((v_ate + 1)::timestamp at time zone 'America/Fortaleza');
  v_res  jsonb;
begin
  perform app.relatorio_imova_porteira();

  with r as (select * from app.imova_ranking_imoveis(v_de, v_fim)),
  i as (
    select x.conversation_id, x.codigo, x.nivel, l.proxima_acao_em, l.proxima_visita
      from app.imova_interesses() x
      join app.imova_leads_agora() l on l.conversation_id = x.conversation_id
     where l.ultima_do_cliente >= v_de and l.ultima_do_cliente < v_fim
  ),
  muito as (
    select i.conversation_id, bool_or(i.proxima_visita is not null or i.proxima_acao_em >= now()) as com_acao
      from i where i.nivel = 'muito' group by 1
  )
  select jsonb_build_object(
    'kpis', jsonb_build_object(
      'no_ar', (select count(*) from r)::int,
      'a_venda', (select count(*) from r where r.preco_venda is not null)::int,
      'para_alugar', (select count(*) from r where r.preco_aluguel is not null)::int,
      'leads_interessados', (select count(distinct i.conversation_id) from i)::int,
      'interesses', (select count(*) from i)::int,
      'muito_interessados', (select count(*) from muito)::int,
      'muito_sem_acao', (select count(*) from muito where not muito.com_acao)::int,
      'sem_interessado', (select count(*) from r where r.total = 0)::int,
      'sem_interessado_exemplo', (select jsonb_build_object('codigo', r.codigo, 'titulo', r.titulo, 'dias_no_ar', r.dias_no_ar)
                                    from r where r.total = 0 order by r.dias_no_ar desc nulls last limit 1)),
    'imoveis', coalesce((select jsonb_agg(app.imova_linha_imovel_json(to_jsonb(r)) order by r.total desc, r.muito desc, r.codigo)
                           from r), '[]'::jsonb),
    'conselho_em', (select max(c.atualizado_em) from public.ia_conselho_do_lead c))
  into v_res;
  return v_res;
end $$;

create or replace function public.relatorio_imova_painel_imovel(p_codigo text, p_de date default null, p_ate date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_hoje date := (now() at time zone 'America/Fortaleza')::date;
  v_ate  date := coalesce(p_ate, v_hoje);
  v_dei  date := coalesce(p_de, v_ate - 29);
  v_de   timestamptz := (v_dei::timestamp at time zone 'America/Fortaleza');
  v_fim  timestamptz := ((v_ate + 1)::timestamp at time zone 'America/Fortaleza');
  v_sem  date := date_trunc('week', (now() at time zone 'America/Fortaleza'))::date;
  v_lin  record;
  v_num  jsonb;
  v_res  jsonb;
begin
  perform app.relatorio_imova_porteira();
  select * into v_lin from app.imova_ranking_imoveis(v_de, v_fim) r where r.codigo = p_codigo;
  if not found then
    return null;
  end if;
  v_num := app.imova_numeros_do_imovel(p_codigo, v_de, v_fim);

  with i as (
    select x.conversation_id, x.nivel, x.primeiro_em
      from app.imova_interesses() x where x.codigo = p_codigo
  ),
  l as (select l.* from app.imova_leads_agora() l join i on i.conversation_id = l.conversation_id)
  select jsonb_build_object(
    'imovel', app.imova_linha_imovel_json(to_jsonb(v_lin)),
    'funil', jsonb_build_object(
      'visualizacoes', v_num -> 'visualizacoes', 'contatos', v_num -> 'contatos',
      'interessados', v_lin.total, 'visitas', v_num -> 'visitas', 'propostas', v_num -> 'propostas'),
    'semanas', (select jsonb_agg(jsonb_build_object('inicio', s.inicio, 'novos',
                                   (select count(*) from i where date_trunc('week', i.primeiro_em at time zone 'America/Fortaleza')::date = s.inicio))
                                 order by s.inicio)
                  from (select (v_sem - 7 * g)::date as inicio from generate_series(0, 7) g) s),
    'entrou_no_ar_em', (select k.no_ar_desde from app.imova_carteira() k where k.codigo = p_codigo),
    'leads', coalesce((select jsonb_agg(jsonb_build_object(
                                'conversation_id', x.conversation_id, 'organization_id', x.organization_id,
                                'nome', x.nome, 'calor', x.calor, 'nivel', x.nivel,
                                'situacao', x.situacao, 'falar', x.falar, 'dono', x.dono)
                              order by x.calor desc, x.nome)
                         from (select l.conversation_id, l.organization_id, l.nome, l.calor, i.nivel,
                                      coalesce(l.conselho_situacao, f.motivo) as situacao,
                                      coalesce(l.conselho_falar, f.proxima_acao) as falar, l.dono
                                 from l join i on i.conversation_id = l.conversation_id
                                 left join public.ficha_da_conversa f on f.conversation_id = l.conversation_id
                                where l.ultima_do_cliente >= v_de and l.ultima_do_cliente < v_fim
                                order by l.calor desc, l.nome limit 5) x), '[]'::jsonb),
    'sugestoes', coalesce((select c.sugestoes from public.ia_conselho_do_imovel c where c.codigo = p_codigo), '[]'::jsonb),
    'sugestoes_em', (select c.atualizado_em from public.ia_conselho_do_imovel c where c.codigo = p_codigo),
    'perguntas', app.imova_perguntas_do_imovel(p_codigo),
    'objecoes', app.imova_objecoes_do_imovel(p_codigo))
  into v_res;
  return v_res;
end $$;

-- 10.3 Funil e equipe
create or replace function public.relatorio_imova_painel_funil(p_de date default null, p_ate date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_hoje  date := (now() at time zone 'America/Fortaleza')::date;
  v_ate   date := coalesce(p_ate, v_hoje);
  v_dei   date := coalesce(p_de, v_ate - 29);
  v_dias  int := (v_ate - v_dei + 1);
  v_de    timestamptz := (v_dei::timestamp at time zone 'America/Fortaleza');
  v_fim   timestamptz := ((v_ate + 1)::timestamp at time zone 'America/Fortaleza');
  v_ade   timestamptz := ((v_dei - v_dias)::timestamp at time zone 'America/Fortaleza');
  v_90    timestamptz := now() - interval '90 days';
  v_res   jsonb;
  v_msgs  jsonb;
  v_media numeric;
begin
  perform app.relatorio_imova_porteira();

  -- As mensagens que mais marcam visita (o relatório de 06/11, mínimo 3 envios).
  select coalesce(jsonb_agg(jsonb_build_object('texto', x.texto, 'enviados', x.maduros, 'visitas_pct', x.pct)
                            order by x.pct desc, x.maduros desc), '[]'::jsonb)
    into v_msgs
    from (select left(m.texto, 200) as texto, m.maduros, round(100.0 * m.visitas / nullif(m.maduros, 0), 1) as pct
            from public.relatorio_imova_mensagens(v_dei, v_ate, 3) m
           where m.maduros >= 5
           order by 3 desc nulls last, m.maduros desc limit 4) x;
  select round(100.0 * sum(m.visitas) / nullif(sum(m.maduros), 0), 1) into v_media
    from public.relatorio_imova_mensagens(v_dei, v_ate, 3) m;

  with agora as (select * from app.imova_funil_periodo(v_de, v_fim)),
  antes as (select * from app.imova_funil_periodo(v_ade, v_de)),
  pr as (select * from app.imova_primeiras_respostas(v_de, v_fim)),
  pr90 as (select * from app.imova_primeiras_respostas(v_90, now())),
  visita_de as (
    select c.id as conversation_id, exists (
             select 1 from public.reunioes r
              where (r.conversation_id = c.id or (c.organization_id is not null and r.organization_id = c.organization_id))
                and r.estado <> 'cancelada') as visitou
      from public.conversations c
  ),
  leads_agora as (select * from app.imova_leads_agora()),
  mesa as (select m.dono_id, m.conversation_id, max(coalesce(m.valor, 0)) as v from app.imova_mesa_agora() m group by 1, 2),
  ganhos as (
    select d.id, d.owner_id, d.won_at,
           (select min(c.created_at) from public.conversations c
             where c.deal_id = d.id or (d.organization_id is not null and c.organization_id = d.organization_id)) as comecou
      from public.deals d join public.pipelines p on p.id = d.pipeline_id and p.slug = 'produtor'
     where d.won_at is not null
  ),
  propostas as (
    select h.deal_id, min(h.changed_at) as em, d.owner_id, d.won_at, d.organization_id
      from public.deal_stage_history h
      join public.stages s on s.id = h.to_stage_id and s.slug = 'parceria_aceita'
      join public.deals d on d.id = h.deal_id
     group by h.deal_id, d.owner_id, d.won_at, d.organization_id
  ),
  pessoas as (
    select p.id, coalesce(nullif(btrim(p.full_name), ''), 'Sem nome') as nome
      from public.profiles p
     where exists (select 1 from public.messages m
                    where m.sent_by = p.id and m.author_kind = 'human' and m.created_at >= v_de and m.created_at < v_fim)
        or exists (select 1 from public.reunioes r where r.marcada_por_id = p.id and r.criada_em >= v_de and r.criada_em < v_fim)
  )
  select jsonb_build_object(
    'periodo', jsonb_build_object('de', v_dei, 'ate', v_ate),
    'kpis', jsonb_build_object(
      'lead_visita', jsonb_build_object(
        'agora', round(100.0 * (select a.leads from agora a where a.posicao = 3) / nullif((select a.leads from agora a where a.posicao = 1), 0), 1),
        'antes', round(100.0 * (select a.leads from antes a where a.posicao = 3) / nullif((select a.leads from antes a where a.posicao = 1), 0), 1)),
      'visita_proposta', jsonb_build_object(
        'agora', round(100.0 * (select a.leads from agora a where a.posicao = 5) / nullif((select a.leads from agora a where a.posicao = 4), 0), 1),
        'antes', round(100.0 * (select a.leads from antes a where a.posicao = 5) / nullif((select a.leads from antes a where a.posicao = 4), 0), 1)),
      'proposta_fechado', jsonb_build_object(
        'agora', round(100.0 * (select a.leads from agora a where a.posicao = 6) / nullif((select a.leads from agora a where a.posicao = 5), 0), 1),
        'antes', round(100.0 * (select a.leads from antes a where a.posicao = 6) / nullif((select a.leads from antes a where a.posicao = 5), 0), 1)),
      'ciclo_dias', jsonb_build_object(
        'agora', (select round((percentile_cont(0.5) within group (order by extract(epoch from g.won_at - g.comecou) / 86400.0))::numeric, 1)
                    from ganhos g where g.won_at >= v_de and g.won_at < v_fim and g.comecou is not null),
        'antes', (select round((percentile_cont(0.5) within group (order by extract(epoch from g.won_at - g.comecou) / 86400.0))::numeric, 1)
                    from ganhos g where g.won_at >= v_ade and g.won_at < v_de and g.comecou is not null)),
      'perdidos', (select count(*) from public.deals d join public.pipelines p on p.id = d.pipeline_id and p.slug = 'produtor'
                    where d.lost_at >= v_de and d.lost_at < v_fim)::int,
      'perdidos_para_outra', (select count(*) from public.deals d join public.pipelines p on p.id = d.pipeline_id and p.slug = 'produtor'
                                join public.lost_reasons lr on lr.id = d.lost_reason_id and lr.slug = 'outra_imobiliaria'
                               where d.lost_at >= v_de and d.lost_at < v_fim)::int),
    'previsao', app.imova_previsao(),
    'premissas', app.relatorio_imova_premissas_json(),
    'funil', (select jsonb_agg(jsonb_build_object(
                       'etapa', a.etapa, 'leads', a.leads, 'antes', b.leads,
                       'passou', case when a.posicao > 1 then round(100.0 * a.leads / nullif(pa.leads, 0), 1) end,
                       'passou_antes', case when a.posicao > 1 then round(100.0 * b.leads / nullif(pb.leads, 0), 1) end,
                       'tempo_horas', case a.posicao
                         when 2 then (select round((percentile_cont(0.5) within group (order by pr.minutos))::numeric / 60.0, 2) from pr where pr.minutos is not null)
                         when 3 then (select round((percentile_cont(0.5) within group (order by extract(epoch from r.criada_em - c.created_at) / 3600.0))::numeric, 1)
                                        from public.reunioes r join public.conversations c on c.id = r.conversation_id
                                       where r.criada_em >= v_de and r.criada_em < v_fim and r.criada_em >= c.created_at)
                         when 4 then (select round((percentile_cont(0.5) within group (order by extract(epoch from r.inicio - r.criada_em) / 3600.0))::numeric, 1)
                                        from public.reunioes r where r.estado = 'realizada' and r.inicio >= v_de and r.inicio < v_fim)
                         when 5 then (select round((percentile_cont(0.5) within group (order by extract(epoch from pp.em - vv.fim) / 3600.0))::numeric, 1)
                                        from propostas pp
                                        join lateral (select max(r.fim) as fim from public.reunioes r
                                                       where r.estado = 'realizada' and r.fim <= pp.em
                                                         and pp.organization_id is not null and r.organization_id = pp.organization_id) vv on vv.fim is not null
                                       where pp.em >= v_de and pp.em < v_fim)
                         when 6 then (select round((percentile_cont(0.5) within group (order by extract(epoch from pp.won_at - pp.em) / 3600.0))::numeric, 1)
                                        from propostas pp where pp.won_at >= v_de and pp.won_at < v_fim)
                       end,
                       'trava', case a.posicao
                         when 2 then (select coalesce(jsonb_agg(jsonb_build_object('motivo', t.motivo, 'pct', t.pct)), '[]'::jsonb)
                                        from (select 'Chegou fora do horário (19h às 8h ou fim de semana)' as motivo,
                                                     round(100.0 * count(*) filter (where extract(isodow from pr.criada_em at time zone 'America/Fortaleza') >= 6
                                                                                       or extract(hour from pr.criada_em at time zone 'America/Fortaleza') >= 19
                                                                                       or extract(hour from pr.criada_em at time zone 'America/Fortaleza') < 8)
                                                           / nullif(count(*), 0), 1) as pct
                                                from pr where pr.minutos is null) t where t.pct > 0)
                         when 3 then app.imova_trava(v_de, v_fim, 'conversaram')
                         when 5 then app.imova_trava(v_de, v_fim, 'visitaram')
                         when 6 then app.imova_trava(v_de, v_fim, 'proposta')
                         when 4 then (select coalesce(jsonb_agg(jsonb_build_object('motivo', t.motivo, 'pct', t.pct) order by t.pct desc), '[]'::jsonb)
                                        from (select case r.estado when 'nao_compareceu' then 'Não apareceu'
                                                                   when 'remarcada' then 'Remarcou'
                                                                   else 'Cancelou' end as motivo,
                                                     round(100.0 * count(*) / nullif(sum(count(*)) over (), 0), 1) as pct
                                                from public.reunioes r
                                               where r.inicio >= v_de and r.inicio < v_fim
                                                 and r.estado in ('nao_compareceu', 'remarcada', 'cancelada')
                                               group by 1) t)
                         else '[]'::jsonb end)
                     order by a.posicao)
                from agora a
                join antes b on b.posicao = a.posicao
                left join agora pa on pa.posicao = a.posicao - 1
                left join antes pb on pb.posicao = a.posicao - 1),
    'ciclo_dias', (select round((percentile_cont(0.5) within group (order by extract(epoch from g.won_at - g.comecou) / 86400.0))::numeric, 1)
                     from ganhos g where g.won_at >= v_de and g.won_at < v_fim and g.comecou is not null),
    'velocidade', (select jsonb_agg(jsonb_build_object('faixa', f.faixa, 'leads', coalesce(x.leads, 0), 'visitas', coalesce(x.visitas, 0))
                                    order by f.ordem)
                     from (values (1, 'ate_5'), (2, '5_15'), (3, '15_60'), (4, '1_4h'), (5, 'mais_4h')) f(ordem, faixa)
                     left join (select case when pr.minutos is null or pr.minutos >= 240 then 'mais_4h'
                                            when pr.minutos < 5 then 'ate_5'
                                            when pr.minutos < 15 then '5_15'
                                            when pr.minutos < 60 then '15_60'
                                            else '1_4h' end as faixa,
                                       count(*)::int as leads,
                                       count(*) filter (where exists (
                                         select 1 from public.reunioes r
                                          where r.conversation_id = pr.conversation_id and r.estado <> 'cancelada'
                                            and r.criada_em < pr.criada_em + interval '14 days'))::int as visitas
                                  from pr group by 1) x on x.faixa = f.faixa),
    'perguntas', (select jsonb_agg(jsonb_build_object(
                           'campo', q.campo,
                           'sabe_pct', (select round(100.0 * count(*) filter (where v.visitou) / nullif(count(*), 0), 1)
                                          from pr90 join public.ficha_da_conversa f on f.conversation_id = pr90.conversation_id
                                          join visita_de v on v.conversation_id = pr90.conversation_id
                                         where nullif(f.dados_extraidos -> q.campo ->> 'valor', '') is not null),
                           'nao_sabe_pct', (select round(100.0 * count(*) filter (where v.visitou) / nullif(count(*), 0), 1)
                                              from pr90 left join public.ficha_da_conversa f on f.conversation_id = pr90.conversation_id
                                              join visita_de v on v.conversation_id = pr90.conversation_id
                                             where nullif(f.dados_extraidos -> q.campo ->> 'valor', '') is null),
                           'falta_em', (select count(*) from leads_agora la
                                         where la.ultima_do_cliente >= now() - interval '30 days'
                                           and nullif(la.dados_extraidos -> q.campo ->> 'valor', '') is null)::int)
                         order by q.ordem)
                    from (values (1, 'valor_maximo'), (2, 'forma_pagamento'), (3, 'prazo_mudanca'), (4, 'decide_com'), (5, 'bairros')) q(ordem, campo)),
    'objecoes', coalesce((select jsonb_agg(jsonb_build_object('objecao', o.nome, 'leads', o.leads, 'visitaram_pct', o.pct)
                                           order by o.leads desc, o.nome)
                            from (select ob.nome, count(distinct co.conversation_id)::int as leads,
                                         round(100.0 * count(distinct co.conversation_id) filter (where v.visitou)
                                               / nullif(count(distinct co.conversation_id), 0), 1) as pct
                                    from public.conversa_objecoes co
                                    join public.objecoes ob on ob.id = co.objecao_id
                                    join public.conversations c on c.id = co.conversation_id
                                    join visita_de v on v.conversation_id = co.conversation_id
                                   where c.last_inbound_at >= v_de and c.created_at < v_fim
                                   group by 1) o), '[]'::jsonb),
    'perdas', coalesce((select jsonb_agg(jsonb_build_object('motivo', x.motivo, 'negocios', x.n) order by x.n desc, x.motivo)
                          from (select coalesce(lr.name, 'Sem motivo') as motivo, count(*)::int as n
                                  from public.deals d
                                  join public.pipelines p on p.id = d.pipeline_id and p.slug = 'produtor'
                                  left join public.lost_reasons lr on lr.id = d.lost_reason_id
                                 where d.lost_at >= v_de and d.lost_at < v_fim
                                 group by 1) x), '[]'::jsonb),
    'canais', null,
    'equipe', coalesce((select jsonb_agg(jsonb_build_object(
                                 'pessoa_id', pe.id, 'nome', pe.nome,
                                 'atendeu', e.atendeu, 'primeira_resposta_min', e.resposta,
                                 'visitas_marcadas', e.marcadas,
                                 'marca_visita_pct', round(100.0 * e.marcadas / nullif(e.atendeu, 0), 1),
                                 'visitas_feitas', e.feitas, 'propostas', e.propostas,
                                 'visita_proposta_pct', round(100.0 * e.propostas / nullif(e.feitas, 0), 1),
                                 'fechou', e.fechou, 'promessas_em_dia_pct', e.promessas,
                                 'parado_valor', e.parado, 'dias_visita_proposta', e.dias_vp)
                               order by e.atendeu desc, pe.nome)
                          from pessoas pe
                          cross join lateral (
                            select
                              (select count(distinct m.conversation_id) from public.messages m
                                where m.sent_by = pe.id and m.author_kind = 'human' and m.direction = 'out'::app.msg_direction
                                  and m.created_at >= v_de and m.created_at < v_fim)::int as atendeu,
                              (select round((percentile_cont(0.5) within group (order by pr.minutos))::numeric, 1)
                                 from pr where pr.por_quem = pe.id and not pr.pela_ia) as resposta,
                              (select count(*) from public.reunioes r
                                where r.marcada_por_id = pe.id and r.criada_em >= v_de and r.criada_em < v_fim and r.estado <> 'cancelada')::int as marcadas,
                              (select count(*) from public.reunioes r
                                where r.dono_id = pe.id and r.estado = 'realizada' and r.inicio >= v_de and r.inicio < v_fim)::int as feitas,
                              (select count(*) from propostas pp where pp.owner_id = pe.id and pp.em >= v_de and pp.em < v_fim)::int as propostas,
                              (select count(*) from ganhos g where g.owner_id = pe.id and g.won_at >= v_de and g.won_at < v_fim)::int as fechou,
                              (select round(100.0 * count(*) filter (where cc.status = 'cumprido' and cc.cumprido_em <= cc.prazo) / nullif(count(*), 0), 1)
                                 from public.compromissos_da_conversa cc
                                 join public.conversations c on c.id = cc.conversation_id
                                where cc.quem = 'equipe' and c.assignee_id = pe.id
                                  and cc.prazo >= v_de and cc.prazo < least(v_fim, now())) as promessas,
                              (select round(coalesce(sum(ms.v), 0), 2) from mesa ms where ms.dono_id = pe.id) as parado,
                              (select round((percentile_cont(0.5) within group (order by extract(epoch from pp.em - vv.fim) / 86400.0))::numeric, 1)
                                 from propostas pp
                                 join lateral (select max(r.fim) as fim from public.reunioes r
                                                where r.estado = 'realizada' and r.fim <= pp.em
                                                  and pp.organization_id is not null and r.organization_id = pp.organization_id) vv on vv.fim is not null
                                where pp.owner_id = pe.id) as dias_vp) e), '[]'::jsonb),
    'ia', jsonb_build_object(
      'atendeu', (select count(distinct q.conversation_id) from public.ia_respostas q
                   where q.message_id is not null and q.criada_em >= v_de and q.criada_em < v_fim
                     and q.conversation_id is distinct from app.ia_conversa_de_treino())::int,
      'primeira_resposta_min', (select round((percentile_cont(0.5) within group (order by pr.minutos))::numeric, 1) from pr where pr.pela_ia),
      'visitas_marcadas', (select count(*) from public.reunioes r
                            where r.marcada_por = 'robo' and r.criada_em >= v_de and r.criada_em < v_fim
                              and r.conversation_id is distinct from app.ia_conversa_de_treino())::int),
    'mensagens', v_msgs,
    'mensagens_media_visita_pct', v_media)
  into v_res;
  return v_res;
end $$;

-- O que mais travou quem passou por uma etapa no período e não chegou à
-- seguinte: as objeções e "não disse o orçamento", em % de quem parou.
create or replace function app.imova_trava(p_de timestamptz, p_fim timestamptz, p_de_onde text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with parados as (
    select c.id
      from public.conversations c
      left join public.organizations o on o.id = c.organization_id
     where c.id is distinct from app.ia_conversa_de_treino()
       and (o.id is null or o.kind::text <> 'fornecedor')
       and case p_de_onde
             when 'conversaram' then
               c.created_at >= p_de and c.created_at < p_fim
               and exists (select 1 from public.messages m where m.conversation_id = c.id
                              and m.direction = 'out'::app.msg_direction and m.author_kind in ('human', 'bot_ai'))
               and not exists (select 1 from public.reunioes r
                                where (r.conversation_id = c.id or (c.organization_id is not null and r.organization_id = c.organization_id))
                                  and r.estado <> 'cancelada')
             when 'visitaram' then
               exists (select 1 from public.reunioes r
                        where (r.conversation_id = c.id or (c.organization_id is not null and r.organization_id = c.organization_id))
                          and r.estado = 'realizada' and r.inicio >= p_de and r.inicio < p_fim)
               and not exists (select 1 from public.deals d
                                join public.deal_stage_history h on h.deal_id = d.id
                                join public.stages s on s.id = h.to_stage_id and s.slug = 'parceria_aceita'
                               where d.id = c.deal_id or (c.organization_id is not null and d.organization_id = c.organization_id))
             when 'proposta' then
               exists (select 1 from public.deals d
                        join public.deal_stage_history h on h.deal_id = d.id
                        join public.stages s on s.id = h.to_stage_id and s.slug = 'parceria_aceita'
                       where (d.id = c.deal_id or (c.organization_id is not null and d.organization_id = c.organization_id))
                         and h.changed_at >= p_de and h.changed_at < p_fim and d.won_at is null)
             else false
           end
  ),
  total as (select count(*) as n from parados),
  motivos as (
    select ob.nome as motivo, count(distinct p.id) as n
      from parados p
      join public.conversa_objecoes co on co.conversation_id = p.id
      join public.objecoes ob on ob.id = co.objecao_id
     group by 1
    union all
    select 'Não disse o orçamento', count(*)
      from parados p
      left join public.ficha_da_conversa f on f.conversation_id = p.id
     where nullif(f.dados_extraidos -> 'valor_maximo' ->> 'valor', '') is null
  )
  select coalesce(jsonb_agg(jsonb_build_object('motivo', x.motivo, 'pct', x.pct) order by x.pct desc), '[]'::jsonb)
    from (select m.motivo, round(100.0 * m.n / nullif(t.n, 0), 1) as pct
            from motivos m cross join total t
           where m.n > 0
           order by 2 desc nulls last limit 2) x;
$$;

-- 10.4 Progresso da IA
create or replace function public.relatorio_imova_painel_ia()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_treino uuid := app.ia_conversa_de_treino();
  v_agora  timestamptz := now();
  v_28     timestamptz := now() - interval '28 days';
  v_56     timestamptz := now() - interval '56 days';
  v_mes    timestamptz := (date_trunc('month', now() at time zone 'America/Fortaleza'))::timestamp at time zone 'America/Fortaleza';
  v_res    jsonb;
begin
  perform app.relatorio_imova_porteira();

  with notas as (
    select n.*, (select avg(v) from unnest(array[n.duvida, n.informacao, n.satisfacao]) v) as media,
           (n.dia::timestamp at time zone 'America/Fortaleza') as em
      from public.ia_atendimento_notas n
     where n.conversation_id is distinct from v_treino
  ),
  resp as (
    select q.* from public.ia_respostas q where q.conversation_id is distinct from v_treino
  ),
  janelas(nome, de, ate) as (values ('agora', v_28, v_agora), ('antes', v_56, v_28)),
  por_janela as (
    select j.nome,
           (select round(avg(n.media), 2) from notas n where n.em >= j.de and n.em < j.ate) as nota,
           (select round(100.0 * count(*) filter (where n.interesse = 'subiu') / nullif(count(n.interesse), 0), 1)
              from notas n where n.em >= j.de and n.em < j.ate) as subiu,
           (select count(*) from public.reunioes r where r.marcada_por = 'robo' and r.conversation_id is distinct from v_treino
               and r.criada_em >= j.de and r.criada_em < j.ate)::int as visitas,
           (select round(100.0 * count(*) filter (where x.falou and not x.passou) / nullif(count(*) filter (where x.falou), 0), 1)
              from (select q.conversation_id,
                           bool_or(q.acao in ('respondeu', 'marcou_visita')) as falou,
                           bool_or(q.acao = 'passou_para_pessoa') as passou
                      from resp q where q.criada_em >= j.de and q.criada_em < j.ate group by 1) x) as resolvidas,
           (select coalesce(sum(a.cost_usd), 0) from public.ai_runs a
             where a.purpose = 'draft_reply' and a.prompt_version like 'atendente-imova@%'
               and a.created_at >= j.de and a.created_at < j.ate) as custo
      from janelas j
  ),
  versoes as (
    select q.prompt_version as versao, min(q.criada_em) as desde
      from resp q where q.prompt_version like 'atendente-imova@%' group by 1
  ),
  passagens as (
    select q.conversation_id, q.criada_em,
           (select min(m.created_at) from public.messages m
             where m.conversation_id = q.conversation_id and m.direction = 'out'::app.msg_direction
               and m.author_kind = 'human' and m.created_at > q.criada_em) as respondeu_em
      from resp q
     where q.acao = 'passou_para_pessoa' and q.criada_em >= v_28
  ),
  passagens_f as (
    select p.*,
           case when p.respondeu_em is null then 'sem_resposta'
                when p.respondeu_em - p.criada_em < interval '15 minutes' then 'ate_15'
                when p.respondeu_em - p.criada_em < interval '60 minutes' then '15_60'
                when p.respondeu_em - p.criada_em < interval '2 hours' then '1_2h'
                else 'mais_2h' end as faixa,
           exists (select 1 from public.reunioes r where r.conversation_id = p.conversation_id
                     and r.criada_em > p.criada_em and r.estado <> 'cancelada') as visitou,
           exists (select 1 from public.atitudes a where a.conversation_id = p.conversation_id
                     and a.etiqueta in ('esfriando', 'sem_resposta')) as esfriou
      from passagens p
  )
  select jsonb_build_object(
    'desde', (select min(q.criada_em) from resp q),
    'semanas', coalesce((select jsonb_agg(jsonb_build_object(
                                  'inicio', s.inicio, 'conversas', s.conversas, 'duvida', s.duvida,
                                  'informacao', s.informacao, 'satisfacao', s.satisfacao,
                                  'subiu_pct', s.subiu_pct, 'igual_pct', s.igual_pct, 'caiu_pct', s.caiu_pct,
                                  'resolvidas_pct', s.resolvidas_pct, 'visitas', s.visitas) order by s.inicio)
                           from app.imova_ia_semanas() s), '[]'::jsonb),
    'versoes', coalesce((select jsonb_agg(jsonb_build_object(
                                  'versao', v.versao, 'desde', v.desde,
                                  'nota_antes', (select round(avg(n.media), 2) from notas n where n.em >= v.desde - interval '14 days' and n.em < v.desde),
                                  'nota_depois', (select round(avg(n.media), 2) from notas n where n.em >= v.desde and n.em < v.desde + interval '14 days'),
                                  'subiu_antes', (select round(100.0 * count(*) filter (where n.interesse = 'subiu') / nullif(count(n.interesse), 0), 1)
                                                    from notas n where n.em >= v.desde - interval '14 days' and n.em < v.desde),
                                  'subiu_depois', (select round(100.0 * count(*) filter (where n.interesse = 'subiu') / nullif(count(n.interesse), 0), 1)
                                                     from notas n where n.em >= v.desde and n.em < v.desde + interval '14 days'))
                                order by v.desde)
                           from versoes v), '[]'::jsonb),
    'kpis', jsonb_build_object(
      'nota', jsonb_build_object('agora', (select p.nota from por_janela p where p.nome = 'agora'),
                                 'antes', (select p.nota from por_janela p where p.nome = 'antes')),
      'mais_interesse', jsonb_build_object('agora', (select p.subiu from por_janela p where p.nome = 'agora'),
                                           'antes', (select p.subiu from por_janela p where p.nome = 'antes')),
      'visitas', jsonb_build_object('agora', (select p.visitas from por_janela p where p.nome = 'agora'),
                                    'antes', (select p.visitas from por_janela p where p.nome = 'antes')),
      'resolvidas', jsonb_build_object('agora', (select p.resolvidas from por_janela p where p.nome = 'agora'),
                                       'antes', (select p.resolvidas from por_janela p where p.nome = 'antes')),
      'custo_mes_usd', (select round(coalesce(sum(a.cost_usd), 0), 2) from public.ai_runs a
                         where a.purpose = 'draft_reply' and a.prompt_version like 'atendente-imova@%' and a.created_at >= v_mes),
      'custo_por_visita_usd', jsonb_build_object(
        'agora', (select round(p.custo / nullif(p.visitas, 0), 2) from por_janela p where p.nome = 'agora'),
        'antes', (select round(p.custo / nullif(p.visitas, 0), 2) from por_janela p where p.nome = 'antes')),
      'teto_mes_usd', (select app.imova_numero(s.value ->> 'mensal_usd') from public.app_settings s where s.key = 'ia.orcamento')),
    'lacunas', coalesce((select jsonb_agg(jsonb_build_object('lacuna', x.lacuna, 'agora', x.agora, 'antes', x.antes)
                                          order by x.agora desc, x.antes desc)
                           from (select n.lacuna,
                                        count(*) filter (where n.em >= v_28)::int as agora,
                                        count(*) filter (where n.em >= v_56 and n.em < v_28)::int as antes
                                   from notas n
                                  where n.lacuna is not null and n.lacuna <> 'nenhuma' and n.em >= v_56
                                  group by 1) x), '[]'::jsonb),
    'passagem', (select jsonb_agg(jsonb_build_object('faixa', f.faixa, 'leads', coalesce(x.leads, 0),
                                                     'visitaram', coalesce(x.visitaram, 0), 'esfriaram', coalesce(x.esfriaram, 0))
                                  order by f.ordem)
                   from (values (1, 'ate_15'), (2, '15_60'), (3, '1_2h'), (4, 'mais_2h'), (5, 'sem_resposta')) f(ordem, faixa)
                   left join (select p.faixa, count(*)::int as leads, count(*) filter (where p.visitou)::int as visitaram,
                                     count(*) filter (where p.esfriou)::int as esfriaram
                                from passagens_f p group by 1) x on x.faixa = f.faixa),
    'passagem_mediana_min', (select round((percentile_cont(0.5) within group (order by extract(epoch from p.respondeu_em - p.criada_em) / 60.0))::numeric, 1)
                               from passagens p where p.respondeu_em is not null))
  into v_res;
  return v_res;
end $$;

-- 10.5 Visão geral
create or replace function public.relatorio_imova_painel_visao(p_de date default null, p_ate date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_hoje  date := (now() at time zone 'America/Fortaleza')::date;
  v_ate   date := coalesce(p_ate, v_hoje);
  v_dei   date := coalesce(p_de, v_ate - 29);
  v_dias  int := (v_ate - v_dei + 1);
  v_de    timestamptz := (v_dei::timestamp at time zone 'America/Fortaleza');
  v_fim   timestamptz := ((v_ate + 1)::timestamp at time zone 'America/Fortaleza');
  v_ade   timestamptz := ((v_dei - v_dias)::timestamp at time zone 'America/Fortaleza');
  v_sem   date := date_trunc('week', (now() at time zone 'America/Fortaleza'))::date;
  v_ia    jsonb;
  v_opo   jsonb;
  v_sug   jsonb := '[]'::jsonb;
  v_res   jsonb;
  v_f     jsonb;
  r       record;
begin
  perform app.relatorio_imova_porteira();
  v_ia  := public.relatorio_imova_painel_ia();
  v_opo := public.relatorio_imova_painel_oportunidades();

  -- As sugestões da semana: o que mais rende primeiro, até 5.
  -- a) O lead parado de maior valor (fora quem só espera resposta).
  select x into v_f from jsonb_array_elements(coalesce(v_opo -> 'fila', '[]'::jsonb)) x
   where x ->> 'situacao' in ('proposta', 'visita', 'promessa') and jsonb_typeof(x -> 'valor') = 'number'
     and (x ->> 'valor')::numeric > 0
   order by (x ->> 'valor')::numeric desc limit 1;
  if v_f is not null then
    v_sug := v_sug || jsonb_build_array(jsonb_build_object(
      'impacto_valor', (v_f ->> 'valor')::numeric, 'impacto_tipo', 'reais', 'unidade', 'de comissão provável',
      'acao', 'Fale hoje com ' || split_part(v_f ->> 'nome', ' ', 1) || ': ' || lower(left(v_f ->> 'fazer', 1)) || substr(v_f ->> 'fazer', 2),
      'porque', (v_f ->> 'porque') || coalesce(' Imóvel ' || (v_f ->> 'codigo') || '.', ''),
      'destino', 'oportunidades', 'alvo', v_f ->> 'conversation_id'));
  end if;
  -- b) Os quentes esperando resposta.
  select count(*) as n, min((x ->> 'desde')::timestamptz) as desde into r
    from jsonb_array_elements(coalesce(v_opo -> 'fila', '[]'::jsonb)) x where x ->> 'situacao' = 'esperando';
  if r.n > 0 then
    v_sug := v_sug || jsonb_build_array(jsonb_build_object(
      'impacto_valor', r.n, 'impacto_tipo', 'leads', 'unidade', 'esperando resposta',
      'acao', case when r.n = 1 then 'Responda o lead quente que está esperando' else 'Responda os ' || r.n || ' leads quentes que estão esperando' end,
      'porque', 'O mais antigo escreveu há ' ||
                case when now() - r.desde < interval '2 hours' then round(extract(epoch from now() - r.desde) / 60) || ' minutos'
                     when now() - r.desde < interval '2 days' then round(extract(epoch from now() - r.desde) / 3600) || ' horas'
                     else round(extract(epoch from now() - r.desde) / 86400) || ' dias' end
                || '. Resposta rápida é o que mais marca visita.',
      'destino', 'oportunidades', 'alvo', null));
  end if;
  -- c) A primeira sugestão do conselheiro para os dois imóveis mais procurados.
  for r in
    select x.codigo, x.titulo, x.total, c.sugestoes -> 0 as s
      from app.imova_ranking_imoveis(v_de, v_fim) x
      join public.ia_conselho_do_imovel c on c.codigo = x.codigo
     where x.total > 0 and jsonb_array_length(c.sugestoes) > 0
     order by x.total desc, x.muito desc limit 2
  loop
    v_sug := v_sug || jsonb_build_array(jsonb_build_object(
      'impacto_valor', r.total, 'impacto_tipo', 'leads', 'unidade', 'interessados no ' || r.codigo,
      'acao', (r.s ->> 'acao'), 'porque', (r.s ->> 'porque'),
      'destino', 'imoveis', 'alvo', r.codigo));
  end loop;
  -- d) Os que combinam com um imóvel e não receberam.
  select coalesce(sum((x ->> 'leads')::int), 0) as n into r
    from jsonb_array_elements(coalesce(v_opo -> 'situacoes', '[]'::jsonb)) x where x ->> 'situacao' = 'combina';
  if r.n > 0 then
    v_sug := v_sug || jsonb_build_array(jsonb_build_object(
      'impacto_valor', r.n, 'impacto_tipo', 'leads', 'unidade', 'sem o imóvel que combina',
      'acao', 'Mande os imóveis que combinam com o que eles pediram',
      'porque', 'Perfil, bairro e teto batem com um imóvel da carteira e ninguém mandou.',
      'destino', 'oportunidades', 'alvo', null));
  end if;
  -- e) A espera depois que a IA passa o lead.
  select coalesce(sum((p ->> 'leads')::int) filter (where p ->> 'faixa' in ('mais_2h', 'sem_resposta')), 0) as n,
         coalesce(sum((p ->> 'esfriaram')::int) filter (where p ->> 'faixa' in ('mais_2h', 'sem_resposta')), 0) as e
    into r
    from jsonb_array_elements(coalesce(v_ia -> 'passagem', '[]'::jsonb)) p;
  if r.n >= 2 then
    v_sug := v_sug || jsonb_build_array(jsonb_build_object(
      'impacto_valor', r.n, 'impacto_tipo', 'leads', 'unidade', 'esperaram mais de 2 h',
      'acao', 'Ponha um plantão para quando a IA passa o lead',
      'porque', case when r.e > 0 then r.e || ' deles esfriaram enquanto esperavam a equipe.'
                     else 'Eles esperaram a equipe depois que a IA passou a conversa.' end,
      'destino', 'ia', 'alvo', null));
  end if;

  with sem as (
    select (v_sem - 7 * g)::date as inicio from generate_series(0, 11) g
  ),
  sem_t as (
    select s.inicio, (s.inicio::timestamp at time zone 'America/Fortaleza') as de,
           ((s.inicio + 7)::timestamp at time zone 'America/Fortaleza') as ate
      from sem s
  ),
  agora as (select * from app.imova_funil_periodo(v_de, v_fim)),
  antes as (select * from app.imova_funil_periodo(v_ade, v_de)),
  pr_agora as (select * from app.imova_primeiras_respostas(v_de, v_fim)),
  pr_antes as (select * from app.imova_primeiras_respostas(v_ade, v_de)),
  por_semana as (
    select s.inicio, f.posicao, f.leads
      from sem_t s cross join lateral app.imova_funil_periodo(s.de, s.ate) f
  ),
  resp_semana as (
    select s.inicio,
           (select round((percentile_cont(0.5) within group (order by p.minutos))::numeric, 1)
              from app.imova_primeiras_respostas(s.de, s.ate) p where p.minutos is not null) as med
      from sem_t s
  )
  select jsonb_build_object(
    'periodo', jsonb_build_object('de', v_dei, 'ate', v_ate),
    'kpis', jsonb_build_object(
      'leads_novos', jsonb_build_object(
        'agora', (select a.leads from agora a where a.posicao = 1), 'antes', (select a.leads from antes a where a.posicao = 1),
        'semanas', (select jsonb_agg(p.leads order by p.inicio) from por_semana p where p.posicao = 1)),
      'primeira_resposta_min', jsonb_build_object(
        'agora', (select round((percentile_cont(0.5) within group (order by p.minutos))::numeric, 1) from pr_agora p where p.minutos is not null),
        'antes', (select round((percentile_cont(0.5) within group (order by p.minutos))::numeric, 1) from pr_antes p where p.minutos is not null),
        'semanas', (select jsonb_agg(r2.med order by r2.inicio) from resp_semana r2)),
      'visitas_marcadas', jsonb_build_object(
        'agora', (select a.leads from agora a where a.posicao = 3), 'antes', (select a.leads from antes a where a.posicao = 3),
        'semanas', (select jsonb_agg(p.leads order by p.inicio) from por_semana p where p.posicao = 3),
        'pela_ia', (select count(*) from public.reunioes r3 where r3.marcada_por = 'robo' and r3.criada_em >= v_de and r3.criada_em < v_fim
                      and r3.conversation_id is distinct from app.ia_conversa_de_treino())),
      'propostas', jsonb_build_object(
        'agora', (select a.leads from agora a where a.posicao = 5), 'antes', (select a.leads from antes a where a.posicao = 5),
        'semanas', (select jsonb_agg(p.leads order by p.inicio) from por_semana p where p.posicao = 5)),
      'fechados', jsonb_build_object(
        'agora', (select a.leads from agora a where a.posicao = 6), 'antes', (select a.leads from antes a where a.posicao = 6),
        'semanas', (select jsonb_agg(p.leads order by p.inicio) from por_semana p where p.posicao = 6),
        'perdidos', (select count(*) from public.deals d join public.pipelines pp on pp.id = d.pipeline_id and pp.slug = 'produtor'
                      where d.lost_at >= v_de and d.lost_at < v_fim)),
      'comissao_parada', jsonb_build_object(
        'agora', v_opo -> 'valor', 'ontem', v_opo -> 'valor_ontem',
        'semanas', (select jsonb_agg((select d.valor from public.relatorio_imova_mesa_dia d
                                       where d.dia >= s.inicio and d.dia < s.inicio + 7 order by d.dia desc limit 1)
                                     order by s.inicio)
                      from sem s))),
    'sugestoes', (select coalesce(jsonb_agg(x.s), '[]'::jsonb) from (select s from jsonb_array_elements(v_sug) s limit 5) x),
    'previsao', app.imova_previsao(),
    'premissas', app.relatorio_imova_premissas_json(),
    'imoveis', coalesce((select jsonb_agg(app.imova_linha_imovel_json(to_jsonb(x)) order by x.total desc, x.muito desc, x.codigo)
                           from (select * from app.imova_ranking_imoveis(v_de, v_fim) y where y.total > 0
                                  order by y.total desc, y.muito desc, y.codigo limit 6) x), '[]'::jsonb),
    'funil', (select jsonb_agg(jsonb_build_object('etapa', a.etapa, 'leads', a.leads) order by a.posicao) from agora a),
    'ia', jsonb_build_object(
      'notas', coalesce((select jsonb_agg(jsonb_build_object('semana', s ->> 'inicio',
                                                            'nota', (select round(avg(v), 2) from unnest(array[(s ->> 'duvida')::numeric,
                                                                     (s ->> 'informacao')::numeric, (s ->> 'satisfacao')::numeric]) v))
                                          order by s ->> 'inicio')
                           from (select s from jsonb_array_elements(v_ia -> 'semanas') s
                                  order by s ->> 'inicio' desc limit 10) x), '[]'::jsonb),
      'versoes', coalesce((select jsonb_agg(jsonb_build_object('versao', v ->> 'versao', 'desde', v ->> 'desde'))
                             from jsonb_array_elements(v_ia -> 'versoes') v), '[]'::jsonb),
      'mais_interesse', v_ia -> 'kpis' -> 'mais_interesse',
      'visitas', v_ia -> 'kpis' -> 'visitas',
      'resolvidas', v_ia -> 'kpis' -> 'resolvidas'),
    'mesa', jsonb_build_object('valor', v_opo -> 'valor', 'leads', v_opo -> 'leads', 'situacoes', v_opo -> 'situacoes'))
  into v_res;
  return v_res;
end $$;

-- 10.6 As premissas, pela tela (admin e gestor)
create or replace function public.relatorio_imova_premissas_salvar(
  p_comissao_venda_pct numeric, p_alugueis_na_locacao numeric, p_meta_mes int default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform app.relatorio_imova_porteira();
  if not coalesce(app.admin_ou_gestor(), false) then
    raise exception 'Só admin e gestor mudam as premissas do relatório' using errcode = '42501';
  end if;
  if p_comissao_venda_pct is null or p_comissao_venda_pct < 0.5 or p_comissao_venda_pct > 20 then
    raise exception 'Comissão da venda fora de 0,5%% a 20%%' using errcode = '22023';
  end if;
  if p_alugueis_na_locacao is null or p_alugueis_na_locacao < 0 or p_alugueis_na_locacao > 3 then
    raise exception 'Aluguéis na locação fora de 0 a 3' using errcode = '22023';
  end if;
  if p_meta_mes is not null and (p_meta_mes < 1 or p_meta_mes > 500) then
    raise exception 'Meta do mês fora de 1 a 500' using errcode = '22023';
  end if;
  insert into public.app_settings (key, value, description, updated_at, updated_by)
  values ('relatorio.premissas',
          jsonb_build_object('comissao_venda_pct', round(p_comissao_venda_pct, 2),
                             'alugueis_na_locacao', round(p_alugueis_na_locacao, 2),
                             'meta_mes', p_meta_mes),
          'As premissas do relatório que vende da Imova (09/11/2026): comissão da venda em %, aluguéis de comissão na locação e a meta de negócios do mês. Mudam pela tela de Relatórios (admin e gestor).',
          now(), auth.uid())
  on conflict (key) do update
     set value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by;
  return app.relatorio_imova_premissas_json();
end $$;

-- =====================================================================
-- 11. Permissões
-- =====================================================================
revoke all on function app.imova_tipo_categoria(text) from public, anon, authenticated;
revoke all on function app.imova_nivel_da_atitude(text) from public, anon, authenticated;
revoke all on function app.imova_numero(text) from public, anon, authenticated;
revoke all on function app.relatorio_imova_premissas() from public, anon, authenticated;
revoke all on function app.relatorio_imova_premissas_json() from public, anon, authenticated;
revoke all on function app.imova_linha_imovel_json(jsonb) from public, anon, authenticated;
revoke all on function app.imova_carteira() from public, anon, authenticated;
revoke all on function app.imova_leads_agora() from public, anon, authenticated;
revoke all on function app.imova_interesses() from public, anon, authenticated;
revoke all on function app.imova_chances() from public, anon, authenticated;
revoke all on function app.imova_mesa_agora() from public, anon, authenticated;
revoke all on function app.relatorio_imova_fotografar_mesa() from public, anon, authenticated;
revoke all on function app.imova_previsao() from public, anon, authenticated;
revoke all on function app.imova_ranking_imoveis(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function app.imova_funil_periodo(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function app.imova_primeiras_respostas(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function app.imova_ia_semanas() from public, anon, authenticated;
revoke all on function app.ia_conselheiro_config() from public, anon, authenticated;
revoke all on function app.ia_conselheiro_enfileirar(text) from public, anon, authenticated;
revoke all on function app.imova_sem_contato(text) from public, anon, authenticated;
revoke all on function app.imova_numeros_do_imovel(text, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function app.imova_perguntas_do_imovel(text) from public, anon, authenticated;
revoke all on function app.imova_objecoes_do_imovel(text) from public, anon, authenticated;
revoke all on function app.imova_trava(timestamptz, timestamptz, text) from public, anon, authenticated;

revoke all on function public.ia_conselheiro_lead_entrada(uuid) from public, anon, authenticated;
revoke all on function public.ia_conselheiro_lead_gravar(uuid, jsonb, bigint, text) from public, anon, authenticated;
revoke all on function public.ia_conselheiro_imovel_entrada(text) from public, anon, authenticated;
revoke all on function public.ia_conselheiro_imovel_gravar(text, jsonb, bigint, text) from public, anon, authenticated;
grant execute on function public.ia_conselheiro_lead_entrada(uuid) to service_role;
grant execute on function public.ia_conselheiro_lead_gravar(uuid, jsonb, bigint, text) to service_role;
grant execute on function public.ia_conselheiro_imovel_entrada(text) to service_role;
grant execute on function public.ia_conselheiro_imovel_gravar(text, jsonb, bigint, text) to service_role;

revoke all on function public.relatorio_imova_painel_visao(date, date) from public, anon;
revoke all on function public.relatorio_imova_painel_imoveis(date, date) from public, anon;
revoke all on function public.relatorio_imova_painel_imovel(text, date, date) from public, anon;
revoke all on function public.relatorio_imova_painel_oportunidades() from public, anon;
revoke all on function public.relatorio_imova_painel_funil(date, date) from public, anon;
revoke all on function public.relatorio_imova_painel_ia() from public, anon;
revoke all on function public.relatorio_imova_premissas_salvar(numeric, numeric, int) from public, anon;
grant execute on function public.relatorio_imova_painel_visao(date, date) to authenticated;
grant execute on function public.relatorio_imova_painel_imoveis(date, date) to authenticated;
grant execute on function public.relatorio_imova_painel_imovel(text, date, date) to authenticated;
grant execute on function public.relatorio_imova_painel_oportunidades() to authenticated;
grant execute on function public.relatorio_imova_painel_funil(date, date) to authenticated;
grant execute on function public.relatorio_imova_painel_ia() to authenticated;
grant execute on function public.relatorio_imova_premissas_salvar(numeric, numeric, int) to authenticated;

  $ddl$;

  -- ===================================================================
  -- 12. O propósito `aconselhar_vendas`, ACRESCENTADO às listas do banco
  -- ===================================================================
  -- Como o `avaliar_atendimento` (20261109200000): logo depois da âncora
  -- 'triar_candidato', sem reescrever as listas.
  select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c
   where c.conname = 'ai_runs_purpose_check' and c.conrelid = 'public.ai_runs'::regclass;
  if v_def is null then
    raise exception 'ai_runs_purpose_check não existe';
  end if;
  if strpos(v_def, '''aconselhar_vendas''') = 0 then
    if (length(v_def) - length(replace(v_def, '''triar_candidato''::text', ''))) / length('''triar_candidato''::text') <> 1 then
      raise exception 'ai_runs_purpose_check: a âncora triar_candidato não aparece uma vez só';
    end if;
    v_novo := replace(v_def, '''triar_candidato''::text', '''triar_candidato''::text, ''aconselhar_vendas''::text');
    alter table public.ai_runs drop constraint ai_runs_purpose_check;
    execute 'alter table public.ai_runs add constraint ai_runs_purpose_check ' || v_novo;
  end if;

  foreach v_alvo in array array[
      'app.ia_enfileirar(text,jsonb,text)'::regprocedure,
      'public.ia_adiar_trabalho(text,jsonb,text,text)'::regprocedure,
      'app.ia_gasto_bloqueado_para()'::regprocedure] loop
    v_def := pg_get_functiondef(v_alvo);
    if strpos(v_def, '''aconselhar_vendas''') = 0 then
      if (length(v_def) - length(replace(v_def, '''triar_candidato''', ''))) / length('''triar_candidato''') <> 1 then
        raise exception '%: a âncora triar_candidato não aparece uma vez só', v_alvo;
      end if;
      execute replace(v_def, '''triar_candidato''', '''triar_candidato'', ''aconselhar_vendas''');
    end if;
  end loop;
end $vende$;

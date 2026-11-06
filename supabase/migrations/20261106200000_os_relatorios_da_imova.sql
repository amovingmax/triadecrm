-- =====================================================================
-- Os relatórios da Imova (06/11/2026)
--
-- Pedido do usuário: a aba Relatórios da Imova mostrar "uma lista de pessoas
-- mais interessadas (clientes mais quentes)", "quantos cliques cada anúncio
-- teve", "indicadores interessantes para maior organização e maior potencial
-- de venda", "o modelo de mensagem que mais retornou resultado positivo" e "o
-- nível de satisfação da IA [...] se cada vez mais ela está deixando mais
-- pessoas interessadas, está tirando dúvidas melhores, entregando informações
-- interessantes, quantas reuniões conseguiu marcar". Decisões dele no mesmo
-- dia (todas as recomendadas):
--   * Clique do anúncio = as visualizações e os contatos que o relatório do
--     Canal Pro traz (ZAP, Viva Real e OLX), mais as conversas e as visitas do
--     imóvel no CRM. O relatório só traz o total acumulado, então cada
--     importação vira uma FOTO, e o período é a diferença entre duas fotos.
--   * Mensagem positiva = o cliente respondeu em até 24 h E ficou Interessado
--     ou Muito interessado. Conta como modelo: modelo aprovado (template_id),
--     resposta rápida (casada pelo texto, porque o atalho só cola o texto) e o
--     texto que o time manda igual para 3 pessoas ou mais.
--   * A IA que atende é medida por indicadores semana a semana e por uma IA
--     JUÍZA: uma vez por dia o Haiku 5.5 lê cada conversa que a IA atendeu na
--     véspera e dá nota de 1 a 5 para "tirou a dúvida", "informação útil" e
--     "cliente satisfeito", com o porquê.
--
-- O QUE ENTRA:
--   1. `canal_pro_fotos`: o que cada importação do relatório do Canal Pro disse
--      de cada anúncio (visualizações, contatos, situação). Escrita por um
--      gatilho em `anuncios_no_canal_pro`, que nunca derruba a importação.
--   2. `ficha_da_conversa_notas`: cada nota de interesse que a leitura da IA
--      deu, com a hora. A ficha guarda só a última; o relatório da IA precisa
--      do "antes" e do "depois".
--   3. A IA juíza: `ia_atendimento_notas`, o propósito `avaliar_atendimento`
--      (acrescentado às listas que estão no banco, sem reescrevê-las), a
--      configuração `ia.juiza`, a fila diária e as portas do worker.
--   4. Os relatórios, cada um uma função `SECURITY DEFINER` com a mesma
--      porteira dos relatórios de sempre (`app.sees_all()`):
--        relatorio_imova_visao_geral   indicadores do período e o que cobrar
--        relatorio_imova_quentes       a lista dos clientes mais quentes, agora
--        relatorio_imova_anuncios      cliques, contatos, conversas e visitas
--        relatorio_imova_mensagens     as mensagens que mais funcionam
--        relatorio_imova_ia            a IA que atende, semana a semana
--
-- O WHATSAPP NÃO MUDA. Nada aqui grava mensagem, enfileira envio ou mexe em
-- janela, conversa ou porteira. Os relatórios só LEEM `messages` e
-- `conversations`; os dois gatilhos novos moram em tabelas que não são do
-- caminho do WhatsApp (`anuncios_no_canal_pro`, `ficha_da_conversa`).
--
-- SÓ DA IMOVA: no banco da KOMUNE nada é criado (fica só o registro da
-- versão). Num banco sem identidade (CI, db reset) tudo é criado, para os
-- testes. A chave `ia.juiza` e o cron moram no seed da Imova (bloco 12j).
-- =====================================================================

do $relatorios$
declare
  v_def   text;
  v_novo  text;
  v_alvo  regprocedure;
begin
  if (select i.empresa from app.identidade i) = 'komune' then
    raise notice 'Os relatórios da Imova são só da Imova: no banco da KOMUNE nada foi criado.';
    return;
  end if;

  execute $ddl$

-- =====================================================================
-- 0. Ajudantes
-- =====================================================================

-- A etiqueta de atitude que valia numa conversa num instante. O histórico
-- guarda cada troca desde que a atitude existe; sem troca até ali, a conversa
-- ainda não tinha etiqueta.
create or replace function app.atitude_em(p_conversation_id uuid, p_em timestamptz)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select h.para from public.atitude_historico h
      where h.conversation_id = p_conversation_id and h.tipo = 'etiqueta' and h.em <= p_em
      order by h.em desc, h.id desc limit 1),
    (select a.etiqueta from public.atitudes a
      where a.conversation_id = p_conversation_id and a.desde <= p_em
        and not exists (select 1 from public.atitude_historico h2
                         where h2.conversation_id = p_conversation_id and h2.tipo = 'etiqueta')));
$$;
comment on function app.atitude_em(uuid, timestamptz) is
  'A etiqueta de atitude que valia na conversa no instante dado (relatórios da Imova, 06/11/2026).';

-- A escada do interesse, para comparar antes e depois: quanto maior, mais perto
-- de comprar. Não contatar e sem interesse ficam no chão.
create or replace function app.atitude_degrau(p_etiqueta text)
returns int
language sql
immutable
set search_path = ''
as $$
  select case p_etiqueta
           when 'muito_interessado' then 5
           when 'interessado'       then 4
           when 'morno'             then 3
           when 'esfriando'         then 2
           when 'sem_resposta'      then 1
           when 'sem_interesse'     then 0
           when 'nao_contatar'      then 0
         end;
$$;

-- O texto de uma mensagem do jeito que o relatório de mensagens compara: sem a
-- assinatura (`*Janio:*` na primeira linha), com o primeiro nome do cliente
-- trocado por {nome} ("Olá, Maria" e "Olá, João" são o mesmo modelo).
-- `p_para_comparar` ainda tira acento, caixa e espaços repetidos.
create or replace function app.texto_de_modelo(p_texto text, p_nomes text[], p_para_comparar boolean)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := coalesce(p_texto, '');
  v_nome text;
begin
  v := regexp_replace(v, '^\s*\*[^*\n]{1,60}:\*[ \t]*\n?', '');
  foreach v_nome in array coalesce(p_nomes, array[]::text[]) loop
    v_nome := split_part(btrim(coalesce(v_nome, '')), ' ', 1);
    -- Só nome de verdade: três letras ou mais, sem número nem símbolo.
    if char_length(v_nome) >= 3 and v_nome ~ '^[[:alpha:]]+$' then
      v := regexp_replace(v, '\m' || v_nome || '\M', '{nome}', 'gi');
    end if;
  end loop;
  v := btrim(v);
  if p_para_comparar then
    v := lower(extensions.unaccent(v));
    v := regexp_replace(v, '\s+', ' ', 'g');
  end if;
  return v;
end $$;
comment on function app.texto_de_modelo(text, text[], boolean) is
  'O texto de uma mensagem como o relatório de mensagens da Imova o compara: sem assinatura, com o nome do cliente trocado por {nome} e, para comparar, sem acento, caixa e espaço repetido.';

-- O que a leitura da IA escreveu do perfil, numa categoria que dá para somar:
-- "aluguel (pergunta se a sala é para aluguel)" é aluguel; "sala no Brisa Mall
-- (comercial)" é comercial. O que não cabe em nenhuma volta como veio.
create or replace function app.procura_em_categoria(p_campo text, p_valor text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
           when x.v = '' then null
           when p_campo = 'finalidade' then
             case when x.v ~ 'compr' and x.v ~ '(alug|loca)' then 'compra ou aluguel'
                  when x.v ~ 'compr' then 'compra'
                  when x.v ~ '(alug|loca)' then 'aluguel'
                  when x.v ~ 'invest' then 'investimento'
                  when x.v ~ 'vend' then 'venda'
                  else x.v end
           when p_campo = 'tipo' then
             case when x.v ~ 'cobertura' then 'cobertura'
                  when x.v ~ '(flat|studio|kitnet|quitinete|loft)' then 'flat ou studio'
                  when x.v ~ '(apart|apto)' then 'apartamento'
                  when x.v ~ '(casa|sobrado|duplex)' then 'casa'
                  when x.v ~ '(terreno|lote)' then 'terreno'
                  when x.v ~ '(sala|loja|comercial|ponto|galpao)' then 'comercial'
                  when x.v ~ '(fazenda|sitio|chacara|granja)' then 'rural'
                  else x.v end
           else x.v
         end
    from (select lower(extensions.unaccent(btrim(coalesce(p_valor, '')))) as v) x;
$$;

-- O número de uma linha do relatório do Canal Pro (visualizações ou contatos).
create or replace function app.canal_pro_total(p_linha jsonb, p_qual text)
returns int
language sql
stable
set search_path = ''
as $$
  select case p_qual
           when 'visualizacoes' then
             app.canal_pro_inteiro(app.canal_pro_campo(p_linha, array['total de visualizacoes', 'visualizacoes']))::int
           when 'contatos' then
             app.canal_pro_inteiro(app.canal_pro_campo(p_linha, array['total de contatos', 'contatos']))::int
         end;
$$;


-- =====================================================================
-- 1. As fotos do relatório do Canal Pro
-- =====================================================================
create table if not exists public.canal_pro_fotos (
  id             bigint generated always as identity primary key,
  codigo         text not null check (char_length(codigo) between 1 and 80),
  em             timestamptz not null default now(),
  visualizacoes  int check (visualizacoes >= 0),
  contatos       int check (contatos >= 0),
  situacao       text check (char_length(situacao) <= 80)
);
create index if not exists canal_pro_fotos_codigo_idx on public.canal_pro_fotos (codigo, em desc);
alter table public.canal_pro_fotos enable row level security;
drop policy if exists canal_pro_fotos_select on public.canal_pro_fotos;
create policy canal_pro_fotos_select on public.canal_pro_fotos
  for select to authenticated using ((select app.is_manager()));
revoke all on public.canal_pro_fotos from anon;
revoke insert, update, delete, truncate on public.canal_pro_fotos from authenticated;
comment on table public.canal_pro_fotos is
  'O que cada importação do relatório do Canal Pro disse de cada anúncio: visualizações e contatos acumulados e a situação (06/11/2026). Escrita só pelo gatilho de anuncios_no_canal_pro; uma linha nova só quando algum número muda.';

create or replace function app.canal_pro_fotografar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vis int;
  v_con int;
  v_ult record;
begin
  if not coalesce(new.no_relatorio, true) then
    return null;
  end if;
  v_vis := app.canal_pro_total(new.linha, 'visualizacoes');
  v_con := app.canal_pro_total(new.linha, 'contatos');
  if v_vis is null and v_con is null then
    return null;
  end if;
  select f.visualizacoes, f.contatos, f.situacao into v_ult
    from public.canal_pro_fotos f
   where f.codigo = new.codigo
   order by f.em desc, f.id desc
   limit 1;
  if found and v_ult.visualizacoes is not distinct from v_vis
     and v_ult.contatos is not distinct from v_con
     and v_ult.situacao is not distinct from new.situacao then
    return null;
  end if;
  insert into public.canal_pro_fotos (codigo, visualizacoes, contatos, situacao)
  values (new.codigo, greatest(v_vis, 0), greatest(v_con, 0), left(new.situacao, 80));
  return null;
exception when others then
  -- Uma foto que falha não pode derrubar a importação do relatório.
  raise warning 'canal_pro_fotografar: % (%)', sqlerrm, sqlstate;
  return null;
end $$;

drop trigger if exists canal_pro_fotografar on public.anuncios_no_canal_pro;
create trigger canal_pro_fotografar
  after insert or update of linha, situacao, no_relatorio on public.anuncios_no_canal_pro
  for each row execute function app.canal_pro_fotografar();

-- A primeira foto é o que já está no banco, na hora em que foi visto.
insert into public.canal_pro_fotos (codigo, em, visualizacoes, contatos, situacao)
select m.codigo, coalesce(m.visto_em, now()),
       greatest(app.canal_pro_total(m.linha, 'visualizacoes'), 0),
       greatest(app.canal_pro_total(m.linha, 'contatos'), 0),
       left(m.situacao, 80)
  from public.anuncios_no_canal_pro m
 where m.no_relatorio
   and (app.canal_pro_total(m.linha, 'visualizacoes') is not null
        or app.canal_pro_total(m.linha, 'contatos') is not null)
   and not exists (select 1 from public.canal_pro_fotos f where f.codigo = m.codigo);


-- =====================================================================
-- 2. As notas de interesse da leitura da IA, com a hora
-- =====================================================================
create table if not exists public.ficha_da_conversa_notas (
  id               bigint generated always as identity primary key,
  conversation_id  uuid not null references public.conversations (id) on delete cascade,
  em               timestamptz not null default now(),
  score_intencao   smallint check (score_intencao between 0 and 100),
  intencao         text,
  sentimento       text
);
create index if not exists ficha_da_conversa_notas_idx on public.ficha_da_conversa_notas (conversation_id, em desc);
alter table public.ficha_da_conversa_notas enable row level security;
drop policy if exists ficha_da_conversa_notas_select on public.ficha_da_conversa_notas;
create policy ficha_da_conversa_notas_select on public.ficha_da_conversa_notas
  for select to authenticated using ((select app.is_manager()));
revoke all on public.ficha_da_conversa_notas from anon;
revoke insert, update, delete, truncate on public.ficha_da_conversa_notas from authenticated;
comment on table public.ficha_da_conversa_notas is
  'Cada nota de interesse (0-100), intenção e sentimento que a leitura da IA deu a uma conversa, com a hora (06/11/2026). A ficha guarda só a última; o relatório da IA que atende compara antes e depois.';

create or replace function app.ficha_anotar_nota()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.score_intencao is null and new.intencao is null then
    return null;
  end if;
  if tg_op = 'UPDATE'
     and new.score_intencao is not distinct from old.score_intencao
     and new.intencao is not distinct from old.intencao
     and new.sentimento is not distinct from old.sentimento then
    return null;
  end if;
  insert into public.ficha_da_conversa_notas (conversation_id, em, score_intencao, intencao, sentimento)
  values (new.conversation_id, coalesce(new.analisada_em, now()), new.score_intencao, new.intencao, new.sentimento);
  return null;
exception when others then
  -- A leitura da IA é gravada mesmo que a nota não seja anotada.
  raise warning 'ficha_anotar_nota: % (%)', sqlerrm, sqlstate;
  return null;
end $$;

drop trigger if exists ficha_anotar_nota on public.ficha_da_conversa;
create trigger ficha_anotar_nota
  after insert or update of score_intencao, intencao, sentimento on public.ficha_da_conversa
  for each row execute function app.ficha_anotar_nota();

insert into public.ficha_da_conversa_notas (conversation_id, em, score_intencao, intencao, sentimento)
select f.conversation_id, coalesce(f.analisada_em, f.updated_at), f.score_intencao, f.intencao, f.sentimento
  from public.ficha_da_conversa f
 where (f.score_intencao is not null or f.intencao is not null)
   and not exists (select 1 from public.ficha_da_conversa_notas n where n.conversation_id = f.conversation_id);


-- =====================================================================
-- 3. A IA juíza
-- =====================================================================
create table if not exists public.ia_atendimento_notas (
  conversation_id      uuid not null references public.conversations (id) on delete cascade,
  -- O dia (America/Fortaleza) das respostas da IA que foram avaliadas.
  dia                  date not null,
  respostas            int not null default 0 check (respostas >= 0),
  -- 1 a 5; nulo = não houve o que avaliar (o cliente não perguntou nada, por exemplo).
  duvida               smallint check (duvida between 1 and 5),
  informacao           smallint check (informacao between 1 and 5),
  satisfacao           smallint check (satisfacao between 1 and 5),
  interesse            text check (interesse in ('subiu', 'igual', 'caiu')),
  porque               text check (char_length(porque) <= 400),
  melhorar             text check (char_length(melhorar) <= 300),
  dados_insuficientes  boolean not null default false,
  ai_run_id            bigint references public.ai_runs (id) on delete set null,
  prompt_version       text,
  criada_em            timestamptz not null default now(),
  primary key (conversation_id, dia)
);
create index if not exists ia_atendimento_notas_dia_idx on public.ia_atendimento_notas (dia desc);
alter table public.ia_atendimento_notas enable row level security;
drop policy if exists ia_atendimento_notas_select on public.ia_atendimento_notas;
create policy ia_atendimento_notas_select on public.ia_atendimento_notas
  for select to authenticated using ((select app.is_manager()));
revoke all on public.ia_atendimento_notas from anon;
revoke insert, update, delete, truncate on public.ia_atendimento_notas from authenticated;
comment on table public.ia_atendimento_notas is
  'A nota que a IA juíza deu a cada dia de atendimento da IA numa conversa (Imova, 06/11/2026): tirou a dúvida, informação útil e cliente satisfeito (1 a 5), o interesse (subiu, igual, caiu), o porquê e o que melhorar. Escrita só por public.ia_juiza_gravar.';

-- A chave `ia.juiza` vem do seed da Imova; sem ela, desligada. Fora de um banco
-- da Imova (ou ainda sem identidade, no CI), também desligada: a juíza só fala
-- da IA que atende, que só existe lá.
create or replace function app.ia_juiza_config()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('ligada', false, 'dias_para_tras', 7, 'por_rodada', 200)
         || coalesce((select s.value from public.app_settings s where s.key = 'ia.juiza'), '{}'::jsonb)
         || case when (select i.empresa from app.identidade i) is distinct from 'imova'
                 then jsonb_build_object('ligada', false) else '{}'::jsonb end;
$$;

-- A fila do dia (cron do seed da Imova, de manhã): cada conversa em que a IA
-- respondeu num dia que já acabou, nos últimos `dias_para_tras`, e que ainda não
-- tem nota. A conversa do treino fica de fora: ali quem fala com a IA é a equipe.
-- A chave da fila é conversa:dia, então pedir duas vezes não paga duas vezes.
create or replace function app.ia_juiza_enfileirar()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cfg    jsonb := app.ia_juiza_config();
  v_hoje   date := (now() at time zone 'America/Fortaleza')::date;
  v_dias   int := greatest(least(coalesce((v_cfg ->> 'dias_para_tras')::int, 7), 30), 1);
  v_limite int := greatest(least(coalesce((v_cfg ->> 'por_rodada')::int, 200), 1000), 1);
  v_treino uuid := app.ia_conversa_de_treino();
  v_res    jsonb;
  v_n      int := 0;
  r        record;
begin
  if not coalesce((v_cfg ->> 'ligada')::boolean, false) then
    return 0;
  end if;
  for r in
    select x.conversation_id, x.dia
      from (select q.conversation_id, (q.criada_em at time zone 'America/Fortaleza')::date as dia
              from public.ia_respostas q
             where q.message_id is not null
               and q.criada_em >= ((v_hoje - v_dias)::timestamp at time zone 'America/Fortaleza')
               and q.criada_em <  (v_hoje::timestamp at time zone 'America/Fortaleza')
               and q.conversation_id is distinct from v_treino
             group by 1, 2) x
     where not exists (select 1 from public.ia_atendimento_notas n
                        where n.conversation_id = x.conversation_id and n.dia = x.dia)
     order by x.dia, x.conversation_id
     limit v_limite
  loop
    v_res := app.ia_enfileirar('avaliar_atendimento',
                               jsonb_build_object('conversation_id', r.conversation_id, 'dia', r.dia),
                               r.conversation_id::text || ':' || r.dia::text);
    if coalesce((v_res ->> 'enfileirado')::boolean, false) then
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $$;
comment on function app.ia_juiza_enfileirar() is
  'A fila da IA juíza (Imova, 06/11/2026): conversa:dia de cada dia já terminado em que a IA respondeu e que ainda não tem nota. Chamada pelo cron do seed da Imova.';

-- A porta de leitura do worker: o dia de atendimento, com um pouco de antes
-- (para a juíza saber o que o cliente tinha perguntado) e as 12 horas seguintes
-- (para ela ver como o cliente reagiu).
create or replace function public.ia_juiza_entrada(p_conversation_id uuid, p_dia date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_conv    public.conversations%rowtype;
  v_ini     timestamptz := (p_dia::timestamp at time zone 'America/Fortaleza');
  v_fim     timestamptz := ((p_dia + 1)::timestamp at time zone 'America/Fortaleza');
  v_primeira timestamptz;
  v_ultima  timestamptz;
  v_msgs    jsonb;
  v_resps   jsonb;
begin
  select * into v_conv from public.conversations c where c.id = p_conversation_id;
  if not found then
    return jsonb_build_object('existe', false);
  end if;

  select min(q.criada_em), max(q.criada_em) into v_primeira, v_ultima
    from public.ia_respostas q
   where q.conversation_id = p_conversation_id and q.message_id is not null
     and q.criada_em >= v_ini and q.criada_em < v_fim;
  if v_primeira is null then
    return jsonb_build_object('existe', true, 'conversation_id', p_conversation_id, 'respostas', 0,
                              'mensagens', '[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id,
           'de', t.de,
           'quando', to_char(t.created_at at time zone 'America/Fortaleza', 'DD/MM HH24:MI'),
           'texto', t.texto) order by t.created_at, t.id), '[]'::jsonb)
    into v_msgs
    from (
      select * from (
        select m.id, m.created_at,
               case when m.direction = 'in'::app.msg_direction then 'cliente'
                    when m.author_kind = 'bot_ai' then 'ia'
                    when m.author_kind = 'human' then 'equipe'
                    else 'automatica' end as de,
               left(coalesce(nullif(btrim(m.body), ''), nullif(btrim(m.transcript), ''),
                             '[' || m.type::text || ']'), 1200) as texto
          from public.messages m
         where m.conversation_id = p_conversation_id
           and m.apagada_em is null
           and m.reage_a is null
           and m.created_at < v_primeira
         order by m.created_at desc
         limit 10) antes
      union all
      select * from (
        select m.id, m.created_at,
               case when m.direction = 'in'::app.msg_direction then 'cliente'
                    when m.author_kind = 'bot_ai' then 'ia'
                    when m.author_kind = 'human' then 'equipe'
                    else 'automatica' end,
               left(coalesce(nullif(btrim(m.body), ''), nullif(btrim(m.transcript), ''),
                             '[' || m.type::text || ']'), 1200)
          from public.messages m
         where m.conversation_id = p_conversation_id
           and m.apagada_em is null
           and m.reage_a is null
           and m.created_at >= v_primeira
           and m.created_at < greatest(v_fim, v_ultima + interval '12 hours')
         order by m.created_at
         limit 70) durante
    ) t;

  select coalesce(jsonb_agg(jsonb_build_object(
           'acao', q.acao,
           'quando', to_char(q.criada_em at time zone 'America/Fortaleza', 'DD/MM HH24:MI'))
           order by q.criada_em), '[]'::jsonb)
    into v_resps
    from public.ia_respostas q
   where q.conversation_id = p_conversation_id
     and q.criada_em >= v_ini and q.criada_em < v_fim;

  return jsonb_build_object(
    'existe', true,
    'conversation_id', v_conv.id,
    'organization_id', v_conv.organization_id,
    'contact_id', v_conv.contact_id,
    'dia', p_dia,
    'respostas', (select count(*) from public.ia_respostas q
                   where q.conversation_id = p_conversation_id and q.message_id is not null
                     and q.criada_em >= v_ini and q.criada_em < v_fim),
    'acoes', v_resps,
    'atitude_antes', app.atitude_em(p_conversation_id, v_primeira - interval '1 second'),
    'atitude_depois', app.atitude_em(p_conversation_id, least(now(), v_ultima + interval '12 hours')),
    'mensagens', v_msgs);
end $$;
comment on function public.ia_juiza_entrada(uuid, date) is
  'Porta de leitura da IA juíza (Imova, 06/11/2026): as mensagens do dia de atendimento da IA, 10 de antes e as reações até 12 h depois, as ações da IA e a atitude antes e depois.';
revoke all on function public.ia_juiza_entrada(uuid, date) from public, anon, authenticated;
grant execute on function public.ia_juiza_entrada(uuid, date) to service_role;

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
    porque, melhorar, dados_insuficientes, ai_run_id, prompt_version, criada_em)
  values (
    p_conversation_id, p_dia, v_n,
    case when (p_saida ->> 'duvida') ~ '^[1-5]$' then (p_saida ->> 'duvida')::smallint end,
    case when (p_saida ->> 'informacao') ~ '^[1-5]$' then (p_saida ->> 'informacao')::smallint end,
    case when (p_saida ->> 'satisfacao') ~ '^[1-5]$' then (p_saida ->> 'satisfacao')::smallint end,
    case when p_saida ->> 'interesse' in ('subiu', 'igual', 'caiu') then p_saida ->> 'interesse' end,
    left(nullif(btrim(coalesce(p_saida ->> 'porque', '')), ''), 400),
    left(nullif(btrim(coalesce(p_saida ->> 'melhorar', '')), ''), 300),
    coalesce((p_saida ->> 'dadosInsuficientes')::boolean, false),
    p_ai_run_id, left(p_prompt_version, 80), now())
  on conflict (conversation_id, dia) do update
     set respostas = excluded.respostas, duvida = excluded.duvida, informacao = excluded.informacao,
         satisfacao = excluded.satisfacao, interesse = excluded.interesse, porque = excluded.porque,
         melhorar = excluded.melhorar, dados_insuficientes = excluded.dados_insuficientes,
         ai_run_id = excluded.ai_run_id, prompt_version = excluded.prompt_version,
         criada_em = excluded.criada_em;
  return jsonb_build_object('ok', true, 'respostas', v_n);
end $$;
comment on function public.ia_juiza_gravar(uuid, date, jsonb, bigint, text) is
  'Porta de escrita da IA juíza (Imova, 06/11/2026): grava a nota do dia da conversa. Nota fora de 1 a 5 vira nula; a mesma conversa e dia regravados trocam a nota.';
revoke all on function public.ia_juiza_gravar(uuid, date, jsonb, bigint, text) from public, anon, authenticated;
grant execute on function public.ia_juiza_gravar(uuid, date, jsonb, bigint, text) to service_role;


-- =====================================================================
-- 4. Os relatórios
-- =====================================================================

-- A porteira de todos: a mesma dos relatórios de sempre.
create or replace function app.relatorio_imova_porteira()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  if not app.sees_all() then
    raise exception 'Papel % não tem acesso aos relatórios', app.role() using errcode = '42501';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 4.1 Os clientes mais quentes, agora
-- ---------------------------------------------------------------------
-- O CALOR (0 a 100): metade a atitude (o que a pessoa FEZ: escreveu, respondeu,
-- parou de responder), metade a nota da leitura da IA (o que ela DISSE: pediu
-- visita, perguntou financiamento). Sem leitura da IA, só a atitude. Mais um
-- bônus por ter falado nos últimos dias e por ter visita marcada.
-- Fora da lista: sem interesse, não contatar, suprimido, ficha excluída,
-- negócio ganho ou perdido, a conversa do treino e conversa concluída.
create or replace function public.relatorio_imova_quentes(p_limite int default 100)
returns table (
  conversation_id     uuid,
  organization_id     uuid,
  nome                text,
  quem                text,
  calor               int,
  atitude             text,
  antes_de_esfriar    text,
  atitude_desde       timestamptz,
  nota_ia             smallint,
  intencao            text,
  motivo_ia           text,
  objecoes            text[],
  procura             text,
  imovel_de_interesse text,
  ultima_do_cliente   timestamptz,
  esperando_resposta  boolean,
  responsavel         text,
  etapa               text,
  proxima_acao        text,
  proxima_acao_em     timestamptz,
  visita_em           timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_treino uuid := app.ia_conversa_de_treino();
begin
  perform app.relatorio_imova_porteira();

  return query
  with base as (
    select c.id as conversation_id, c.organization_id, c.peer_phone_e164, c.last_inbound_at,
           c.last_outbound_at, c.assignee_id, c.deal_id,
           coalesce(nullif(btrim(o.name), ''), nullif(btrim(c.peer_nome), ''), 'Sem nome') as nome,
           case when o.id is null then 'Sem ficha'
                when o.kind::text = 'fornecedor' then 'Proprietário'
                else 'Cliente' end as quem,
           a.etiqueta, a.antes_de_esfriar, a.desde,
           f.score_intencao, f.intencao, f.motivo, f.dados_extraidos
      from public.conversations c
      left join public.organizations o on o.id = c.organization_id
      left join public.atitudes a on a.conversation_id = c.id
      left join public.ficha_da_conversa f on f.conversation_id = c.id
     where c.id is distinct from v_treino
       and c.arquivada_em is null
       and c.bloqueada_em is null
       and c.last_inbound_at is not null
       and (a.etiqueta is not null or f.score_intencao is not null)
       and coalesce(a.etiqueta, '') not in ('sem_interesse', 'nao_contatar')
       and (o.id is null or (o.deleted_at is null and not coalesce(o.do_not_contact, false)))
       and not app.is_suppressed(c.peer_phone_e164, null, null)
  ),
  com_negocio as (
    select b.*, d.id as negocio_id, d.next_action, d.next_action_at, s.name as etapa_nome,
           coalesce(s.is_won, false) or coalesce(s.is_lost, false) as encerrado
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
           -- "Interessado" é o ponto de partida de quem escreveu por conta
           -- própria; "Muito interessado" é quem fez mais que isso.
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
  select k.conversation_id, k.organization_id, k.nome, k.quem,
         least(100, greatest(0,
           case when k.score_intencao is null then coalesce(k.peso, 0)
                when k.peso is null then k.score_intencao
                else round((k.peso + k.score_intencao) / 2.0)::int end
           + case when k.last_inbound_at >= now() - interval '1 day' then 10
                  when k.last_inbound_at >= now() - interval '3 days' then 6
                  when k.last_inbound_at >= now() - interval '7 days' then 3
                  else 0 end
           + case when k.proxima_visita is not null then 10 else 0 end))::int as calor,
         k.etiqueta, k.antes_de_esfriar, k.desde,
         k.score_intencao, k.intencao, k.motivo,
         coalesce((select array_agg(distinct ob.nome order by ob.nome)
                     from public.conversa_objecoes co
                     join public.objecoes ob on ob.id = co.objecao_id
                    where co.conversation_id = k.conversation_id and co.resolvida_em is null),
                  array[]::text[]),
         nullif(concat_ws(' · ',
           nullif(k.dados_extraidos -> 'finalidade' ->> 'valor', ''),
           nullif(k.dados_extraidos -> 'tipo_imovel' ->> 'valor', ''),
           case when nullif(k.dados_extraidos -> 'quartos' ->> 'valor', '') is not null
                then (k.dados_extraidos -> 'quartos' ->> 'valor') || ' quartos' end,
           nullif(k.dados_extraidos -> 'bairros' ->> 'valor', ''),
           case when nullif(k.dados_extraidos -> 'valor_maximo' ->> 'valor', '') is not null
                then 'até ' || (k.dados_extraidos -> 'valor_maximo' ->> 'valor') end), ''),
         nullif(k.dados_extraidos -> 'imovel_de_interesse' ->> 'valor', ''),
         k.last_inbound_at,
         k.last_inbound_at > coalesce(k.last_outbound_at, '-infinity'::timestamptz),
         p.full_name,
         k.etapa_nome,
         k.next_action, k.next_action_at,
         k.proxima_visita
    from calculado k
    left join public.profiles p on p.id = k.assignee_id
   order by 5 desc, k.last_inbound_at desc nulls last
   limit greatest(least(coalesce(p_limite, 100), 500), 1);
end $$;
comment on function public.relatorio_imova_quentes(int) is
  'Os clientes mais quentes da Imova agora (06/11/2026): calor de 0 a 100 = metade a atitude, metade a nota da leitura da IA, com bônus por falar nos últimos dias e por visita marcada; com o que procura, objeções, quem atende, etapa, próxima ação e visita.';

-- ---------------------------------------------------------------------
-- 4.2 Os anúncios: cliques (visualizações), contatos, conversas e visitas
-- ---------------------------------------------------------------------
-- Um anúncio por código: os do CRM (não excluídos) e os que só existem no
-- Canal Pro (não marcados como excluídos, sem cartão no CRM).
-- No período: a diferença entre a última foto até o fim e a última antes do
-- começo. Sem foto antes do começo, só se o anúncio foi criado no período
-- (aí tudo é do período); senão, nulo (não dá para saber).
-- Conversa do anúncio: a mensagem do cliente que cita o código (o texto pronto
-- do ZAP traz "Código da oferta"), o imóvel de interesse que a leitura da IA
-- achou, o lead do portal ligado à conversa ou a visita que a IA marcou.
create or replace function public.relatorio_imova_anuncios(p_de date default null, p_ate date default null)
returns table (
  codigo                 text,
  titulo                 text,
  onde                   text,
  situacao               text,
  bairro                 text,
  preco_venda            bigint,
  preco_aluguel          bigint,
  visualizacoes          int,
  visualizacoes_periodo  int,
  contatos               int,
  contatos_periodo       int,
  taxa_de_contato        numeric,
  conversas              int,
  visitas                int,
  foto_em                timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_hoje date := (now() at time zone 'America/Fortaleza')::date;
  v_ate  date := coalesce(p_ate, v_hoje);
  v_dei  date := coalesce(p_de, v_ate - 29);
  v_de   timestamptz := (v_dei::timestamp at time zone 'America/Fortaleza');
  v_fim  timestamptz := ((v_ate + 1)::timestamp at time zone 'America/Fortaleza');
begin
  perform app.relatorio_imova_porteira();

  return query
  with lista as (
    select a.codigo, a.titulo, 'CRM'::text as onde,
           coalesce(m.situacao, case a.situacao when 'no_ar' then 'No ar' when 'rascunho' then 'Rascunho'
                                                 when 'pausado' then 'Pausado' else a.situacao end) as situacao,
           a.bairro, a.preco_venda, a.preco_aluguel,
           coalesce(a.publicado_em, a.criado_em) as criado_em,
           m.linha
      from public.anuncios a
      left join public.anuncios_no_canal_pro m on m.codigo = a.codigo
     where a.excluido_em is null
    union all
    select m.codigo, m.titulo, 'Canal Pro', m.situacao, m.bairro, m.preco_venda, m.preco_aluguel,
           null::timestamptz, m.linha
      from public.anuncios_no_canal_pro m
     where m.anuncio_id is null and m.excluido_em is null
       and not exists (select 1 from public.anuncios a where a.codigo = m.codigo and a.excluido_em is null)
  ),
  numeros as (
    select l.*,
           fim.visualizacoes as vis_fim, fim.contatos as con_fim, fim.em as foto_fim,
           ini.visualizacoes as vis_ini, ini.contatos as con_ini,
           -- Quando o anúncio nasceu nos portais: a "Criação" do relatório do
           -- Canal Pro (DD-MM-AAAA) vale mais que a data em que ele entrou no
           -- CRM — o trazido do Canal Pro hoje tem anos de visualização.
           coalesce(case when app.canal_pro_campo(l.linha, array['criacao', 'data de criacao']) ~ '^\d{2}-\d{2}-\d{4}'
                         then to_date(left(app.canal_pro_campo(l.linha, array['criacao', 'data de criacao']), 10), 'DD-MM-YYYY')::timestamp
                              at time zone 'America/Fortaleza' end,
                    l.criado_em) as nasceu_em,
           -- O pedaço do código que o cliente escreve ("TE0002" de "TE0002_IMOVA").
           lower(extensions.unaccent(split_part(l.codigo, '_', 1))) as chave
      from lista l
      left join lateral (select f.visualizacoes, f.contatos, f.em from public.canal_pro_fotos f
                          where f.codigo = l.codigo and f.em < v_fim
                          order by f.em desc, f.id desc limit 1) fim on true
      left join lateral (select f.visualizacoes, f.contatos from public.canal_pro_fotos f
                          where f.codigo = l.codigo and f.em < v_de
                          order by f.em desc, f.id desc limit 1) ini on true
  ),
  conversas_do_anuncio as (
    select n.codigo, x.conversation_id
      from numeros n
      cross join lateral (
        select m.conversation_id
          from public.messages m
         where char_length(n.chave) >= 4
           and m.direction = 'in'::app.msg_direction
           and m.created_at >= v_de and m.created_at < v_fim
           and strpos(lower(extensions.unaccent(coalesce(m.body, ''))), n.chave) > 0
        union
        select f.conversation_id
          from public.ficha_da_conversa f
          join public.conversations c on c.id = f.conversation_id
         where char_length(n.chave) >= 4
           and c.last_inbound_at >= v_de and c.created_at < v_fim
           and strpos(lower(extensions.unaccent(coalesce(f.dados_extraidos -> 'imovel_de_interesse' ->> 'valor', ''))),
                      n.chave) > 0
        union
        select pl.conversation_id
          from public.portal_leads pl
          left join public.anuncios a on a.id = pl.anuncio_id
          left join public.anuncios_no_canal_pro mm on mm.id = pl.anuncio_no_canal_pro_id
         where pl.conversation_id is not null
           and coalesce(a.codigo, mm.codigo) = n.codigo
           and pl.recebido_em >= v_de and pl.recebido_em < v_fim
        union
        select q.conversation_id
          from public.ia_respostas q
         where q.acao = 'marcou_visita' and q.message_id is not null
           and q.detalhes ->> 'imovel' = n.codigo
           and q.criada_em >= v_de and q.criada_em < v_fim
      ) x
  )
  select n.codigo, n.titulo, n.onde, n.situacao, n.bairro, n.preco_venda, n.preco_aluguel,
         n.vis_fim,
         case when n.vis_fim is null then null
              when n.vis_ini is not null then greatest(n.vis_fim - n.vis_ini, 0)
              when n.nasceu_em >= v_de then n.vis_fim
         end,
         n.con_fim,
         case when n.con_fim is null then null
              when n.con_ini is not null then greatest(n.con_fim - n.con_ini, 0)
              when n.nasceu_em >= v_de then n.con_fim
         end,
         case when coalesce(n.vis_fim, 0) > 0 then round(coalesce(n.con_fim, 0) * 100.0 / n.vis_fim, 1) end,
         (select count(distinct ca.conversation_id)::int from conversas_do_anuncio ca where ca.codigo = n.codigo),
         (select count(distinct r.id)::int
            from public.reunioes r
           where r.criada_em >= v_de and r.criada_em < v_fim
             and r.estado not in ('cancelada', 'remarcada')
             and (strpos(lower(extensions.unaccent(coalesce(r.observacao, ''))), n.chave) > 0 and char_length(n.chave) >= 4
                  or r.conversation_id in (select ca.conversation_id from conversas_do_anuncio ca
                                            where ca.codigo = n.codigo))),
         n.foto_fim
    from numeros n
   order by coalesce(n.vis_fim, -1) desc, n.codigo;
end $$;
comment on function public.relatorio_imova_anuncios(date, date) is
  'Os anúncios da Imova no período (06/11/2026): visualizações e contatos do relatório do Canal Pro (total e diferença entre fotos), taxa de contato, conversas que citaram o anúncio e visitas.';

-- ---------------------------------------------------------------------
-- 4.3 As mensagens que mais funcionam
-- ---------------------------------------------------------------------
-- Cada mensagem do time (gente ou automática; a IA tem o relatório dela) vira
-- um "modelo": o modelo aprovado que ela usou, a resposta rápida cujo texto ela
-- carrega, ou o próprio texto, quando o time mandou igual para `p_minimo`
-- pessoas ou mais (e ele tem pelo menos 20 letras: "ok" não é modelo).
-- Conta só o PRIMEIRO envio de cada modelo a cada conversa no período, e só
-- depois de 24 h ("maduro"): antes disso o cliente ainda pode responder.
-- Positivo = respondeu em até 24 h e, nesse instante, a atitude era
-- Interessado ou Muito interessado. Visita = marcada até 7 dias depois.
create or replace function public.relatorio_imova_mensagens(
  p_de date default null, p_ate date default null, p_minimo int default 3)
returns table (
  chave              text,
  tipo               text,
  nome               text,
  texto              text,
  envios             int,
  conversas          int,
  maduros            int,
  responderam        int,
  interessaram       int,
  visitas            int,
  taxa_resposta      numeric,
  taxa_positiva      numeric,
  taxa_visita        numeric,
  ultimo_envio       timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_hoje   date := (now() at time zone 'America/Fortaleza')::date;
  v_ate    date := coalesce(p_ate, v_hoje);
  v_dei    date := coalesce(p_de, v_ate - 29);
  v_de     timestamptz := (v_dei::timestamp at time zone 'America/Fortaleza');
  v_fim    timestamptz := ((v_ate + 1)::timestamp at time zone 'America/Fortaleza');
  v_minimo int := greatest(coalesce(p_minimo, 3), 2);
  v_treino uuid := app.ia_conversa_de_treino();
begin
  perform app.relatorio_imova_porteira();

  return query
  with saidas as (
    select m.id, m.conversation_id, c.organization_id, m.created_at, m.template_id,
           app.texto_de_modelo(m.body, array[c.peer_nome, o.name], false) as exibido,
           app.texto_de_modelo(m.body, array[c.peer_nome, o.name], true) as comparado
      from public.messages m
      join public.conversations c on c.id = m.conversation_id
      left join public.organizations o on o.id = c.organization_id
     where m.direction = 'out'::app.msg_direction
       and m.author_kind in ('human', 'bot_fixed')
       and m.created_at >= v_de and m.created_at < v_fim
       and m.status not in ('failed'::app.msg_status)
       and m.apagada_em is null
       and m.reage_a is null
       and not m.optout_confirmation
       and c.id is distinct from v_treino
       and (m.template_id is not null or char_length(btrim(coalesce(m.body, ''))) > 0)
  ),
  rapidas as (
    select r.id, r.atalho, r.titulo, r.texto,
           app.texto_de_modelo(r.texto, array[]::text[], true) as comparado
      from public.respostas_rapidas r
  ),
  classificadas as (
    select s.*,
           case when s.template_id is not null then 'modelo:' || s.template_id
                when rr.id is not null then 'rapida:' || rr.id
                else 'texto:' || md5(s.comparado) end as grupo,
           case when s.template_id is not null then 'modelo'
                when rr.id is not null then 'resposta_rapida'
                else 'texto_repetido' end as tipo_do_grupo,
           case when s.template_id is not null then mt.name
                when rr.id is not null then '/' || rr.atalho || ' · ' || rr.titulo end as nome_do_grupo,
           case when s.template_id is not null then coalesce(nullif(s.exibido, ''), mt.body)
                when rr.id is not null then rr.texto
                else s.exibido end as texto_do_grupo
      from saidas s
      left join public.message_templates mt on mt.id = s.template_id
      left join lateral (
        select r.* from rapidas r
         where s.template_id is null
           and (r.comparado = s.comparado
                or (char_length(r.comparado) >= 20 and strpos(s.comparado, r.comparado) > 0))
         order by char_length(r.comparado) desc
         limit 1) rr on true
  ),
  grupos as (
    select g.grupo, max(g.tipo_do_grupo) as tipo_do_grupo, max(g.nome_do_grupo) as nome_do_grupo,
           (array_agg(g.texto_do_grupo order by g.created_at desc))[1] as texto_do_grupo,
           count(*)::int as envios, count(distinct g.conversation_id)::int as conversas,
           max(g.created_at) as ultimo, min(char_length(g.comparado)) as tamanho
      from classificadas g
     group by g.grupo
  ),
  validos as (
    select gr.* from grupos gr
     where gr.tipo_do_grupo <> 'texto_repetido'
        or (gr.conversas >= v_minimo and gr.tamanho >= 20)
  ),
  primeiros as (
    select distinct on (g.grupo, g.conversation_id) g.grupo, g.conversation_id, g.organization_id, g.created_at
      from classificadas g
      join validos v on v.grupo = g.grupo
     order by g.grupo, g.conversation_id, g.created_at
  ),
  desfechos as (
    select p.grupo,
           p.created_at <= now() - interval '24 hours' as maduro,
           r.respondeu_em,
           r.respondeu_em is not null
             and app.atitude_em(p.conversation_id, r.respondeu_em + interval '2 minutes')
                 in ('interessado', 'muito_interessado') as interessou,
           exists (select 1 from public.reunioes rr
                    where (rr.conversation_id = p.conversation_id
                           or (p.organization_id is not null and rr.organization_id = p.organization_id))
                      and rr.criada_em > p.created_at
                      and rr.criada_em <= p.created_at + interval '7 days') as visita
      from primeiros p
      left join lateral (
        select min(m.created_at) as respondeu_em
          from public.messages m
         where m.conversation_id = p.conversation_id
           and m.direction = 'in'::app.msg_direction
           and m.created_at > p.created_at
           and m.created_at <= p.created_at + interval '24 hours') r on true
  ),
  somas as (
    select d.grupo,
           count(*) filter (where d.maduro)::int as maduros,
           count(*) filter (where d.maduro and d.respondeu_em is not null)::int as responderam,
           count(*) filter (where d.maduro and d.interessou)::int as interessaram,
           count(*) filter (where d.maduro and d.visita)::int as visitas
      from desfechos d
     group by d.grupo
  )
  select v.grupo, v.tipo_do_grupo, v.nome_do_grupo, left(v.texto_do_grupo, 1000),
         v.envios, v.conversas,
         coalesce(s.maduros, 0), coalesce(s.responderam, 0), coalesce(s.interessaram, 0), coalesce(s.visitas, 0),
         case when coalesce(s.maduros, 0) > 0 then round(s.responderam * 100.0 / s.maduros, 1) end,
         case when coalesce(s.maduros, 0) > 0 then round(s.interessaram * 100.0 / s.maduros, 1) end,
         case when coalesce(s.maduros, 0) > 0 then round(s.visitas * 100.0 / s.maduros, 1) end,
         v.ultimo
    from validos v
    left join somas s on s.grupo = v.grupo
   order by (coalesce(s.maduros, 0) > 0) desc,
            case when coalesce(s.maduros, 0) > 0 then s.interessaram * 1.0 / s.maduros end desc nulls last,
            coalesce(s.maduros, 0) desc, v.envios desc;
end $$;
comment on function public.relatorio_imova_mensagens(date, date, int) is
  'As mensagens que mais funcionam na Imova (06/11/2026): modelo aprovado, resposta rápida ou texto repetido pelo time; de cada uma, quantos responderam em 24 h, quantos responderam e ficaram interessados e quantos marcaram visita em 7 dias.';

-- ---------------------------------------------------------------------
-- 4.4 A IA que atende, semana a semana
-- ---------------------------------------------------------------------
-- As respostas que saíram no período (sem o treino), com o que aconteceu
-- depois: quanto a IA demorou e se o cliente voltou a escrever em 24 h.
-- Função, e não tabela temporária: o relatório roda em transação só de leitura.
create or replace function app.relatorio_imova_ia_respostas(p_de timestamptz, p_fim timestamptz)
returns table (
  id uuid, conversation_id uuid, criada_em timestamptz, acao text, avaliacao text,
  semana date, demora_seg numeric, continuou boolean, maduro boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select q.id, q.conversation_id, q.criada_em, q.acao, q.avaliacao,
         date_trunc('week', q.criada_em at time zone 'America/Fortaleza')::date,
         extract(epoch from (q.criada_em - em.created_at))::numeric,
         exists (select 1 from public.messages m
                  where m.conversation_id = q.conversation_id
                    and m.direction = 'in'::app.msg_direction
                    and m.created_at > q.criada_em
                    and m.created_at <= q.criada_em + interval '24 hours'),
         q.criada_em <= now() - interval '24 hours'
    from public.ia_respostas q
    left join public.messages em on em.id = q.em_resposta_a
   where q.message_id is not null
     and q.criada_em >= p_de and q.criada_em < p_fim
     and q.conversation_id is distinct from app.ia_conversa_de_treino();
$$;
revoke all on function app.relatorio_imova_ia_respostas(timestamptz, timestamptz) from public, anon, authenticated;

create or replace function public.relatorio_imova_ia(p_de date default null, p_ate date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_hoje   date := (now() at time zone 'America/Fortaleza')::date;
  v_ate    date := coalesce(p_ate, v_hoje);
  v_dei    date := coalesce(p_de, v_ate - 29);
  v_de     timestamptz := (v_dei::timestamp at time zone 'America/Fortaleza');
  v_fim    timestamptz := ((v_ate + 1)::timestamp at time zone 'America/Fortaleza');
  v_corte  timestamptz := least(now(), v_fim);
  v_treino uuid := app.ia_conversa_de_treino();
  v_totais jsonb;
  v_interesse jsonb;
  v_juiza  jsonb;
  v_semanas jsonb;
begin
  perform app.relatorio_imova_porteira();

  select jsonb_build_object(
           'respostas', count(*),
           'conversas', count(distinct r.conversation_id),
           'visitas_marcadas', count(*) filter (where r.acao = 'marcou_visita'),
           'passadas', count(*) filter (where r.acao = 'passou_para_pessoa'),
           'boas', count(*) filter (where r.avaliacao = 'boa'),
           'corrigidas', count(*) filter (where r.avaliacao = 'corrigir'),
           'maduras', count(*) filter (where r.maduro),
           'continuou', count(*) filter (where r.maduro and r.continuou),
           'mediana_resposta_seg', round((percentile_cont(0.5) within group (order by r.demora_seg))::numeric),
           'silencios', (select count(*) from public.ia_respostas q
                          where q.message_id is null and q.acao = 'nao_respondeu'
                            and q.criada_em >= v_de and q.criada_em < v_fim
                            and q.conversation_id is distinct from v_treino),
           'no_treino', (select count(*) from public.ia_respostas q
                          where q.message_id is not null and q.conversation_id = v_treino
                            and q.criada_em >= v_de and q.criada_em < v_fim),
           'visitas_realizadas', (select count(*) from public.reunioes rr
                                   where rr.marcada_por = 'robo' and rr.estado = 'realizada'
                                     and rr.inicio >= v_de and rr.inicio < v_fim),
           'visitas_faltou', (select count(*) from public.reunioes rr
                               where rr.marcada_por = 'robo' and rr.estado = 'nao_compareceu'
                                 and rr.inicio >= v_de and rr.inicio < v_fim),
           'pediram_para_parar', (select count(distinct h.conversation_id) from public.atitude_historico h
                                   where h.tipo = 'etiqueta' and h.para = 'nao_contatar'
                                     and h.em >= v_de and h.em < v_fim
                                     and exists (select 1 from app.relatorio_imova_ia_respostas(v_de, v_fim) r2
                                                  where r2.conversation_id = h.conversation_id
                                                    and r2.criada_em < h.em)),
           'custo_usd', (select coalesce(round(sum(a.cost_usd)::numeric, 4), 0) from public.ai_runs a
                          where a.created_at >= v_de and a.created_at < v_fim
                            and ((a.purpose = 'draft_reply' and a.prompt_version like 'atendente-imova@%')
                                 or a.purpose = 'avaliar_atendimento')))
    into v_totais
    from app.relatorio_imova_ia_respostas(v_de, v_fim) r;

  -- O interesse antes e depois: a atitude logo antes da primeira resposta da IA
  -- no período e a de agora (ou do fim do período); a nota da leitura da IA,
  -- a última antes e a última até o fim.
  with primeiras as (
    select r.conversation_id, min(r.criada_em) as primeira
      from app.relatorio_imova_ia_respostas(v_de, v_fim) r group by r.conversation_id
  ),
  comparadas as (
    select p.conversation_id,
           app.atitude_degrau(app.atitude_em(p.conversation_id, p.primeira - interval '1 second')) as antes,
           app.atitude_degrau(app.atitude_em(p.conversation_id, v_corte)) as depois,
           (select n.score_intencao from public.ficha_da_conversa_notas n
             where n.conversation_id = p.conversation_id and n.em < p.primeira and n.score_intencao is not null
             order by n.em desc limit 1) as nota_antes,
           (select n.score_intencao from public.ficha_da_conversa_notas n
             where n.conversation_id = p.conversation_id and n.em >= p.primeira and n.em < v_corte
               and n.score_intencao is not null
             order by n.em desc limit 1) as nota_depois
      from primeiras p
  )
  select jsonb_build_object(
           'conversas', count(*),
           'subiu', count(*) filter (where c.depois > c.antes),
           'igual', count(*) filter (where c.depois = c.antes),
           'caiu',  count(*) filter (where c.depois < c.antes),
           'sem_dado', count(*) filter (where c.antes is null or c.depois is null),
           'nota_antes', round(avg(c.nota_antes) filter (where c.nota_antes is not null and c.nota_depois is not null)),
           'nota_depois', round(avg(c.nota_depois) filter (where c.nota_antes is not null and c.nota_depois is not null)),
           'com_nota', count(*) filter (where c.nota_antes is not null and c.nota_depois is not null))
    into v_interesse
    from comparadas c;

  -- A juíza: as notas dos dias do período.
  select jsonb_build_object(
           'avaliadas', count(*),
           'duvida', round(avg(n.duvida), 1),
           'informacao', round(avg(n.informacao), 1),
           'satisfacao', round(avg(n.satisfacao), 1),
           'subiu', count(*) filter (where n.interesse = 'subiu'),
           'igual', count(*) filter (where n.interesse = 'igual'),
           'caiu', count(*) filter (where n.interesse = 'caiu'),
           'piores', coalesce((
             select jsonb_agg(x order by x.media, x.dia desc) from (
               select n2.conversation_id, c.organization_id,
                      coalesce(nullif(btrim(o.name), ''), nullif(btrim(c.peer_nome), ''), 'Sem nome') as nome,
                      n2.dia, n2.duvida, n2.informacao, n2.satisfacao, n2.interesse, n2.porque, n2.melhorar,
                      round((coalesce(n2.duvida, 3) + coalesce(n2.informacao, 3) + coalesce(n2.satisfacao, 3)) / 3.0, 1) as media
                 from public.ia_atendimento_notas n2
                 join public.conversations c on c.id = n2.conversation_id
                 left join public.organizations o on o.id = c.organization_id
                where n2.dia between v_dei and v_ate and not n2.dados_insuficientes
                  and least(coalesce(n2.duvida, 5), coalesce(n2.informacao, 5), coalesce(n2.satisfacao, 5)) <= 3
                order by 11, n2.dia desc
                limit 8) x), '[]'::jsonb),
           'melhores', coalesce((
             select jsonb_agg(x order by x.media desc, x.dia desc) from (
               select n2.conversation_id, c.organization_id,
                      coalesce(nullif(btrim(o.name), ''), nullif(btrim(c.peer_nome), ''), 'Sem nome') as nome,
                      n2.dia, n2.duvida, n2.informacao, n2.satisfacao, n2.interesse, n2.porque, n2.melhorar,
                      round((coalesce(n2.duvida, 3) + coalesce(n2.informacao, 3) + coalesce(n2.satisfacao, 3)) / 3.0, 1) as media
                 from public.ia_atendimento_notas n2
                 join public.conversations c on c.id = n2.conversation_id
                 left join public.organizations o on o.id = c.organization_id
                where n2.dia between v_dei and v_ate and not n2.dados_insuficientes
                  and least(coalesce(n2.duvida, 5), coalesce(n2.informacao, 5), coalesce(n2.satisfacao, 5)) >= 4
                order by 11 desc, n2.dia desc
                limit 3) x), '[]'::jsonb),
           'ligada', coalesce((app.ia_juiza_config() ->> 'ligada')::boolean, false))
    into v_juiza
    from public.ia_atendimento_notas n
   where n.dia between v_dei and v_ate and not n.dados_insuficientes;

  -- Semana a semana (segunda-feira de cada semana).
  with semanas as (
    select generate_series(date_trunc('week', v_dei::timestamp)::date,
                           date_trunc('week', v_ate::timestamp)::date, interval '7 days')::date as semana
  ),
  por_semana as (
    select r.semana,
           count(*) as respostas,
           count(distinct r.conversation_id) as conversas,
           count(*) filter (where r.acao = 'marcou_visita') as visitas,
           count(*) filter (where r.acao = 'passou_para_pessoa') as passadas,
           count(*) filter (where r.avaliacao = 'boa') as boas,
           count(*) filter (where r.avaliacao = 'corrigir') as corrigidas,
           count(*) filter (where r.maduro) as maduras,
           count(*) filter (where r.maduro and r.continuou) as continuou
      from app.relatorio_imova_ia_respostas(v_de, v_fim) r
     group by r.semana
  ),
  interesse_semana as (
    select x.semana,
           count(*) as conversas,
           count(*) filter (where x.depois > x.antes) as subiu
      from (select r.semana, r.conversation_id,
                   app.atitude_degrau(app.atitude_em(r.conversation_id, min(r.criada_em) - interval '1 second')) as antes,
                   app.atitude_degrau(app.atitude_em(r.conversation_id,
                     least(v_corte, ((r.semana + 7)::timestamp at time zone 'America/Fortaleza')))) as depois
              from app.relatorio_imova_ia_respostas(v_de, v_fim) r
             group by r.semana, r.conversation_id) x
     where x.antes is not null and x.depois is not null
     group by x.semana
  ),
  juiza_semana as (
    select date_trunc('week', n.dia::timestamp)::date as semana,
           count(*) as avaliadas,
           round(avg(n.duvida), 1) as duvida,
           round(avg(n.informacao), 1) as informacao,
           round(avg(n.satisfacao), 1) as satisfacao
      from public.ia_atendimento_notas n
     where n.dia between v_dei and v_ate and not n.dados_insuficientes
     group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'semana', s.semana,
           'respostas', coalesce(p.respostas, 0),
           'conversas', coalesce(p.conversas, 0),
           'visitas', coalesce(p.visitas, 0),
           'passadas', coalesce(p.passadas, 0),
           'boas', coalesce(p.boas, 0),
           'corrigidas', coalesce(p.corrigidas, 0),
           'maduras', coalesce(p.maduras, 0),
           'continuou', coalesce(p.continuou, 0),
           'interesse_conversas', coalesce(i.conversas, 0),
           'interesse_subiu', coalesce(i.subiu, 0),
           'avaliadas', coalesce(j.avaliadas, 0),
           'duvida', j.duvida,
           'informacao', j.informacao,
           'satisfacao', j.satisfacao) order by s.semana), '[]'::jsonb)
    into v_semanas
    from semanas s
    left join por_semana p on p.semana = s.semana
    left join interesse_semana i on i.semana = s.semana
    left join juiza_semana j on j.semana = s.semana;

  return jsonb_build_object(
    'periodo', jsonb_build_object('de', v_dei, 'ate', v_ate),
    'ia', (select jsonb_build_object('ligada', coalesce((v.value ->> 'ligada')::boolean, false),
                                     'modo', v.value ->> 'modo')
             from public.app_settings v where v.key = 'ia.atendente'),
    'totais', v_totais,
    'interesse', v_interesse,
    'juiza', v_juiza,
    'semanas', v_semanas);
end $$;
comment on function public.relatorio_imova_ia(date, date) is
  'A IA que atende da Imova no período (06/11/2026): respostas, visitas, passagens, Boa/Corrigir, se o cliente continuou, interesse antes e depois, as notas da IA juíza e a série semana a semana.';

-- ---------------------------------------------------------------------
-- 4.5 A visão geral: o período em números e o que cobrar hoje
-- ---------------------------------------------------------------------
create or replace function public.relatorio_imova_visao_geral(p_de date default null, p_ate date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_hoje   date := (now() at time zone 'America/Fortaleza')::date;
  v_ate    date := coalesce(p_ate, v_hoje);
  v_dei    date := coalesce(p_de, v_ate - 29);
  v_de     timestamptz := (v_dei::timestamp at time zone 'America/Fortaleza');
  v_fim    timestamptz := ((v_ate + 1)::timestamp at time zone 'America/Fortaleza');
  v_treino uuid := app.ia_conversa_de_treino();
  v_contatos jsonb;
  v_agora  jsonb;
  v_visitas jsonb;
  v_funil  jsonb;
  v_objecoes jsonb;
  v_procura jsonb;
  v_oferta jsonb;
  v_anuncios jsonb;
begin
  perform app.relatorio_imova_porteira();

  -- Quem escreveu pela primeira vez no período, e em quanto tempo alguém (gente
  -- ou a IA) respondeu. Mensagem automática não conta como resposta.
  with primeiras as (
    select m.conversation_id, min(m.created_at) as chegou
      from public.messages m
     where m.direction = 'in'::app.msg_direction
       and m.conversation_id is distinct from v_treino
     group by m.conversation_id
    having min(m.created_at) >= v_de and min(m.created_at) < v_fim
  ),
  respostas as (
    select p.conversation_id, p.chegou,
           (select min(m.created_at) from public.messages m
             where m.conversation_id = p.conversation_id
               and m.direction = 'out'::app.msg_direction
               and m.author_kind in ('human', 'bot_ai')
               and m.status <> 'failed'::app.msg_status
               and m.created_at > p.chegou) as respondeu
      from primeiras p
  )
  select jsonb_build_object(
           'novos', count(*),
           'atendidos', count(*) filter (where r.respondeu is not null),
           'mediana_primeira_resposta_min',
             round((percentile_cont(0.5) within group (order by extract(epoch from (r.respondeu - r.chegou)) / 60.0)
                    filter (where r.respondeu is not null))::numeric),
           'em_ate_15_min', count(*) filter (where r.respondeu <= r.chegou + interval '15 minutes'),
           'nunca_responderam', count(*) filter (where r.respondeu is null))
    into v_contatos
    from respostas r;

  -- O que está parado agora (não depende do período).
  select jsonb_build_object(
           'esperando_resposta', count(*) filter (where c.last_inbound_at > coalesce(c.last_outbound_at, '-infinity'::timestamptz)),
           'esperando_mais_de_1h', count(*) filter (where c.last_inbound_at > coalesce(c.last_outbound_at, '-infinity'::timestamptz)
                                                     and c.last_inbound_at < now() - interval '1 hour'),
           'esperando_desde', min(c.last_inbound_at) filter (where c.last_inbound_at > coalesce(c.last_outbound_at, '-infinity'::timestamptz)),
           'muito_interessados', count(*) filter (where a.etiqueta = 'muito_interessado'),
           'interessados', count(*) filter (where a.etiqueta = 'interessado'),
           'esfriando', count(*) filter (where a.etiqueta = 'esfriando'),
           'quentes_sem_proximo_passo', count(*) filter (
              where a.etiqueta in ('muito_interessado', 'interessado')
                and not exists (select 1 from public.deals d join public.stages s on s.id = d.stage_id
                                 where d.organization_id = c.organization_id
                                   and not s.is_won and not s.is_lost
                                   and nullif(btrim(coalesce(d.next_action, '')), '') is not null
                                   and (d.next_action_at is null or d.next_action_at >= now()))
                and not exists (select 1 from public.reunioes r
                                 where (r.conversation_id = c.id or r.organization_id = c.organization_id)
                                   and r.inicio > now() and r.estado in ('a_confirmar', 'marcada', 'confirmada'))),
           'proxima_acao_vencida', (select count(*) from public.deals d join public.stages s on s.id = d.stage_id
                                     join public.organizations o on o.id = d.organization_id
                                    where not s.is_won and not s.is_lost and o.deleted_at is null
                                      and d.next_action_at < now()
                                      and nullif(btrim(coalesce(d.next_action, '')), '') is not null))
    into v_agora
    from public.conversations c
    left join public.atitudes a on a.conversation_id = c.id
   where c.id is distinct from v_treino
     and c.arquivada_em is null
     and c.bloqueada_em is null;

  select jsonb_build_object(
           'marcadas', count(*) filter (where r.criada_em >= v_de and r.criada_em < v_fim and r.remarcada_de is null),
           'pela_ia', count(*) filter (where r.criada_em >= v_de and r.criada_em < v_fim and r.remarcada_de is null
                                         and r.marcada_por = 'robo'),
           'aconteceram', count(*) filter (where r.inicio >= v_de and r.inicio < least(v_fim, now())
                                             and r.estado in ('realizada', 'nao_compareceu', 'marcada', 'confirmada', 'a_confirmar')),
           'realizadas', count(*) filter (where r.inicio >= v_de and r.inicio < v_fim and r.estado = 'realizada'),
           'faltaram', count(*) filter (where r.inicio >= v_de and r.inicio < v_fim and r.estado = 'nao_compareceu'),
           'canceladas', count(*) filter (where r.inicio >= v_de and r.inicio < v_fim and r.estado = 'cancelada'),
           'sem_desfecho', count(*) filter (where r.inicio >= v_de and r.inicio < least(v_fim, now())
                                              and r.estado in ('marcada', 'confirmada', 'a_confirmar')),
           'proximas', count(*) filter (where r.inicio >= now() and r.estado in ('marcada', 'confirmada', 'a_confirmar')))
    into v_visitas
    from public.reunioes r;

  -- O funil dos clientes: quantos negócios ENTRARAM em cada etapa no período.
  select coalesce(jsonb_agg(jsonb_build_object('etapa', x.name, 'posicao', x.position, 'chegaram', x.chegaram,
                                               'ganho', x.is_won) order by x.position), '[]'::jsonb)
    into v_funil
    from (select s.name, s.position, s.is_won,
                 (select count(distinct h.deal_id) from public.deal_stage_history h
                   where h.to_stage_id = s.id and h.changed_at >= v_de and h.changed_at < v_fim) as chegaram
            from public.stages s
            join public.pipelines p on p.id = s.pipeline_id
           where p.slug = 'produtor'
             and not s.is_entry and not s.is_lost and not coalesce(s.is_optout, false)
             -- Nutrição fica fora; a etapa ganha fica, mesmo que um dia seja marcada dormente.
             and (s.is_won or not coalesce(s.is_dormant, false))
             and s.retired_at is null) x;

  -- As objeções das conversas que falaram no período: a marcada pelo time e a
  -- que a leitura da IA achou, sem contar a mesma conversa duas vezes.
  with ativas as (
    select c.id from public.conversations c
     where c.last_inbound_at >= v_de and c.created_at < v_fim and c.id is distinct from v_treino
  ),
  achadas as (
    select co.conversation_id, ob.slug, ob.nome
      from public.conversa_objecoes co
      join public.objecoes ob on ob.id = co.objecao_id
     where co.conversation_id in (select id from ativas)
    union
    select f.conversation_id, x.slug, coalesce(ob.nome, initcap(replace(x.slug, '_', ' ')))
      from public.ficha_da_conversa f
      cross join lateral unnest(f.objecoes) as x(slug)
      left join public.objecoes ob on ob.slug = x.slug
     where f.conversation_id in (select id from ativas)
  )
  select coalesce(jsonb_agg(jsonb_build_object('objecao', y.nome, 'conversas', y.n) order by y.n desc, y.nome), '[]'::jsonb)
    into v_objecoes
    from (select max(a.nome) as nome, count(distinct a.conversation_id) as n
            from achadas a group by a.slug order by 2 desc limit 8) y;

  -- O que os clientes procuram (a leitura da IA de quem falou no período).
  with perfis as (
    select f.dados_extraidos as d
      from public.ficha_da_conversa f
      join public.conversations c on c.id = f.conversation_id
      left join public.organizations o on o.id = c.organization_id
     where c.last_inbound_at >= v_de and c.created_at < v_fim
       and c.id is distinct from v_treino
       and coalesce(o.kind::text, 'produtor') <> 'fornecedor'
  ),
  valores as (
    select 'finalidade' as campo, app.procura_em_categoria('finalidade', p.d -> 'finalidade' ->> 'valor') as valor
      from perfis p
    union all
    select 'tipo', app.procura_em_categoria('tipo', p.d -> 'tipo_imovel' ->> 'valor') from perfis p
    union all
    select 'bairro', btrim(b) from perfis p
      cross join lateral regexp_split_to_table(coalesce(p.d -> 'bairros' ->> 'valor', ''), '\s*(,|;|/|\se\s|\sou\s)\s*') b
  )
  select jsonb_build_object(
           'clientes', (select count(*) from perfis p where p.d <> '{}'::jsonb),
           'finalidade', coalesce((select jsonb_agg(jsonb_build_object('valor', z.valor, 'clientes', z.n) order by z.n desc)
                                     from (select v.valor, count(*) as n from valores v
                                            where v.campo = 'finalidade' and coalesce(v.valor, '') <> ''
                                            group by v.valor order by 2 desc limit 6) z), '[]'::jsonb),
           'tipos', coalesce((select jsonb_agg(jsonb_build_object('valor', z.valor, 'clientes', z.n) order by z.n desc)
                                from (select v.valor, count(*) as n from valores v
                                       where v.campo = 'tipo' and coalesce(v.valor, '') <> ''
                                       group by v.valor order by 2 desc limit 8) z), '[]'::jsonb))
    into v_procura;

  -- Procura × oferta por bairro: quantos clientes pedem o bairro e quantos
  -- anúncios a Imova tem no ar (ou ativos no Canal Pro) nele.
  with perfis as (
    select f.dados_extraidos as d
      from public.ficha_da_conversa f
      join public.conversations c on c.id = f.conversation_id
      left join public.organizations o on o.id = c.organization_id
     where c.last_inbound_at >= v_de and c.created_at < v_fim
       and c.id is distinct from v_treino
       and coalesce(o.kind::text, 'produtor') <> 'fornecedor'
  ),
  pedidos as (
    select btrim(b) as bairro, lower(extensions.unaccent(btrim(b))) as chave
      from perfis p
      cross join lateral regexp_split_to_table(coalesce(p.d -> 'bairros' ->> 'valor', ''), '\s*(,|;|/|\se\s|\sou\s)\s*') b
     where char_length(btrim(b)) >= 3
  ),
  oferta as (
    select lower(extensions.unaccent(btrim(a.bairro))) as chave, count(*) as n
      from public.anuncios a
     where a.excluido_em is null and a.situacao = 'no_ar' and nullif(btrim(coalesce(a.bairro, '')), '') is not null
     group by 1
    union all
    select lower(extensions.unaccent(btrim(m.bairro))), count(*)
      from public.anuncios_no_canal_pro m
     where m.anuncio_id is null and m.excluido_em is null and m.no_relatorio
       and app.canal_pro_ativo_no_relatorio(m.situacao)
       and nullif(btrim(coalesce(m.bairro, '')), '') is not null
       and not exists (select 1 from public.anuncios a where a.codigo = m.codigo and a.excluido_em is null)
     group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object('bairro', z.bairro, 'procurando', z.procurando, 'anuncios', z.anuncios)
                            order by z.procurando desc, z.bairro), '[]'::jsonb)
    into v_oferta
    from (select max(p.bairro) as bairro, count(*) as procurando,
                 coalesce((select sum(o.n) from oferta o where o.chave = p.chave), 0) as anuncios
            from pedidos p group by p.chave order by 2 desc limit 10) z;

  select jsonb_build_object(
           'no_ar', (select count(*) from public.anuncios a where a.excluido_em is null and a.situacao = 'no_ar'),
           'visualizacoes_periodo', sum(x.visualizacoes_periodo),
           'contatos_periodo', sum(x.contatos_periodo),
           'conversas', sum(x.conversas),
           'ultima_foto', max(x.foto_em))
    into v_anuncios
    from public.relatorio_imova_anuncios(v_dei, v_ate) x;

  return jsonb_build_object(
    'periodo', jsonb_build_object('de', v_dei, 'ate', v_ate),
    'contatos', v_contatos,
    'agora', v_agora,
    'visitas', v_visitas,
    'funil', v_funil,
    'fechados', (select count(distinct d.id) from public.deals d join public.stages s on s.id = d.stage_id
                  join public.pipelines p on p.id = d.pipeline_id
                 where p.slug = 'produtor' and s.is_won and d.won_at >= v_de and d.won_at < v_fim),
    'perdidos', (select count(distinct d.id) from public.deals d join public.stages s on s.id = d.stage_id
                  join public.pipelines p on p.id = d.pipeline_id
                 where p.slug = 'produtor' and s.is_lost and d.lost_at >= v_de and d.lost_at < v_fim),
    'objecoes', v_objecoes,
    'procura', v_procura,
    'procura_e_oferta', v_oferta,
    'anuncios', v_anuncios);
end $$;
comment on function public.relatorio_imova_visao_geral(date, date) is
  'A visão geral da Imova (06/11/2026): quem chegou e em quanto tempo foi atendido, o que está parado agora, visitas, funil dos clientes, objeções, o que os clientes procuram, procura × oferta por bairro e o resumo dos anúncios.';

revoke all on function app.relatorio_imova_porteira() from public, anon;
revoke all on function public.relatorio_imova_quentes(int) from public, anon;
revoke all on function public.relatorio_imova_anuncios(date, date) from public, anon;
revoke all on function public.relatorio_imova_mensagens(date, date, int) from public, anon;
revoke all on function public.relatorio_imova_ia(date, date) from public, anon;
revoke all on function public.relatorio_imova_visao_geral(date, date) from public, anon;
grant execute on function app.relatorio_imova_porteira() to authenticated;
grant execute on function public.relatorio_imova_quentes(int) to authenticated;
grant execute on function public.relatorio_imova_anuncios(date, date) to authenticated;
grant execute on function public.relatorio_imova_mensagens(date, date, int) to authenticated;
grant execute on function public.relatorio_imova_ia(date, date) to authenticated;
grant execute on function public.relatorio_imova_visao_geral(date, date) to authenticated;

  $ddl$;

  -- ===================================================================
  -- 5. O propósito `avaliar_atendimento`, ACRESCENTADO às listas do banco
  -- ===================================================================
  -- `ai_runs.purpose`, `app.ia_enfileirar`, `public.ia_adiar_trabalho` e
  -- `app.ia_gasto_bloqueado_para` têm a lista fechada de propósitos. Em vez de
  -- reescrever cada uma (e apagar o propósito que outra frente tenha posto),
  -- a lista que está no banco ganha o nosso logo depois de 'triar_candidato'.
  -- Se a âncora não estiver lá exatamente uma vez, a migração para.
  select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c
   where c.conname = 'ai_runs_purpose_check' and c.conrelid = 'public.ai_runs'::regclass;
  if v_def is null then
    raise exception 'ai_runs_purpose_check não existe';
  end if;
  if strpos(v_def, '''avaliar_atendimento''') = 0 then
    if (length(v_def) - length(replace(v_def, '''triar_candidato''::text', ''))) / length('''triar_candidato''::text') <> 1 then
      raise exception 'ai_runs_purpose_check: a âncora triar_candidato não aparece uma vez só';
    end if;
    v_novo := replace(v_def, '''triar_candidato''::text', '''triar_candidato''::text, ''avaliar_atendimento''::text');
    alter table public.ai_runs drop constraint ai_runs_purpose_check;
    execute 'alter table public.ai_runs add constraint ai_runs_purpose_check ' || v_novo;
  end if;

  foreach v_alvo in array array[
      'app.ia_enfileirar(text,jsonb,text)'::regprocedure,
      'public.ia_adiar_trabalho(text,jsonb,text,text)'::regprocedure,
      'app.ia_gasto_bloqueado_para()'::regprocedure] loop
    v_def := pg_get_functiondef(v_alvo);
    if strpos(v_def, '''avaliar_atendimento''') = 0 then
      if (length(v_def) - length(replace(v_def, '''triar_candidato''', ''))) / length('''triar_candidato''') <> 1 then
        raise exception '%: a âncora triar_candidato não aparece uma vez só', v_alvo;
      end if;
      execute replace(v_def, '''triar_candidato''', '''triar_candidato'', ''avaliar_atendimento''');
    end if;
  end loop;
end $relatorios$;

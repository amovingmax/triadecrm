-- =====================================================================
-- A IA que atende o cliente sozinha — só na Imova (06/11/2026)
--
-- Pedido do usuário: "utilizar uma IA para responder os clientes no CRM da
-- Imova. Essa IA deve responder o cliente sozinho e tirar as dúvidas dele
-- também [...] para suprir as necessidades do nosso colaborador com
-- deficiência motora, ele não consegue escrever as mensagens para os
-- clientes". Decisões dele no mesmo dia:
--   * "Essa trava não pode existir na Imova": o texto da IA sai SEM rascunho
--     aprovado. O ADR-05 (e o ADR-16, a recusa de 28/09) continuam valendo na
--     KOMUNE, onde esta migração não cria nada.
--   * A IA responde sozinha até um fator que é de gente: ligação de áudio,
--     conduzir a visita, falar com um corretor. Quando alguém pede corretor,
--     ela avisa na hora que vai passar e passa.
--   * O colaborador pode parar a IA numa conversa e passar para outra pessoa.
--   * Ela assina "Imova" para o cliente (é a IA do Rafael, o colaborador).
--   * Ela fala de todos os anúncios, imóveis e terrenos (a aba Anúncios).
--   * Marca visita.
--   * Uma semana de treino pela conversa do Janio Ramalho (da equipe), que é
--     dedicada a treinar a IA e passar instruções a ela.
--
-- O QUE ENTRA:
--   1. Preço do Claude Opus 5.5 e do Sonnet 5.5 em `ai_model_prices`.
--   2. `ia_atendimento`: em que conversa a IA está atendendo ou foi parada.
--   3. `ia_caderno`: o que a IA sabe da Imova além dos anúncios (instruções
--      do treino, correções das respostas, o que a gestão escrever).
--   4. `ia_respostas`: cada resposta da IA, a prova que a porteira confere e
--      a avaliação (Boa / Corrigir) de quem acompanha.
--   5. As funções do worker (entrada, dizer, passar, marcar visita, anotar)
--      e as da tela (ligar, parar, configurar, caderno, avaliar, placar).
--   6. A fila: `app.ia_atendente_enfileirar`, chamada pelo cron do seed da
--      Imova (bloco 12h) a cada 10 segundos.
--   7. A PORTEIRA (`app.messages_guard`) ganha o ramo (2a): `bot_ai` sem
--      rascunho passa SÓ quando `public.ia_atendente_*` registrou o mesmo
--      corpo em `ia_respostas` NESTA transação, numa conversa em que a IA
--      atende. O resto da porteira (supressão, janela de 24 h, horário,
--      tetos, conversa bloqueada) vale igual. A troca é feita sobre a função
--      que está no banco (`pg_get_functiondef` + um único trecho trocado), e
--      a migração aborta se o trecho não estiver lá exatamente uma vez.
--
-- O WHATSAPP NÃO MUDA DE CAMINHO: a resposta é uma linha em `messages` com
-- status `queued`, que o worker-wa manda como manda qualquer outra.
--
-- SÓ DA IMOVA: no banco da KOMUNE nada é criado e a porteira fica como está;
-- num banco sem identidade (CI, db reset) tudo é criado, para os testes.
-- =====================================================================

do $atende$
declare
  v_def    text;
  v_ancora text := E'    -- (2) HUMAN-IN-THE-LOOP (ADR-05, RF-CON-22).\n'
                || E'    if new.author_kind = ''bot_ai'' then\n'
                || E'      if new.draft_id is null then';
  v_trecho text := E'    -- (2) HUMAN-IN-THE-LOOP (ADR-05, RF-CON-22).\n'
                || E'    -- (2a) A IA QUE ATENDE SOZINHA, SÓ NA IMOVA (06/11/2026): o usuário\n'
                || E'    --      pediu "essa trava não pode existir na Imova". Passa sem\n'
                || E'    --      rascunho só o texto que `app.ia_atendente_dizer` registrou NESTA\n'
                || E'    --      transação em `ia_respostas`, com o mesmo corpo, numa conversa em\n'
                || E'    --      que a IA atende. A porteira (3) continua valendo inteira.\n'
                || E'    if new.author_kind = ''bot_ai'' and new.draft_id is null\n'
                || E'       and app.ia_atendente_autoriza(new.conversation_id, new.body) then\n'
                || E'      new.approved_by := null;\n'
                || E'    elsif new.author_kind = ''bot_ai'' then\n'
                || E'      if new.draft_id is null then';
  v_vezes  int;
begin
  if (select i.empresa from app.identidade i) = 'komune' then
    raise notice 'A IA que atende o cliente é só da Imova: no banco da KOMUNE nada foi criado e a porteira não mudou.';
    return;
  end if;

  execute $ddl$

-- =====================================================================
-- 1. Os preços (US$ por milhão de tokens; escrita de cache = 1,25× a entrada)
-- =====================================================================
insert into public.ai_model_prices (model, rotulo, entrada, saida, escrita_de_cache, leitura_de_cache, vigente_desde)
values
  ('claude-opus-5-5', 'Claude Opus 5.5 — a IA que atende o cliente da Imova (06/11/2026)',
   4.00, 20.00, 5.00, 0.20, '2026-11-06'),
  ('claude-sonnet-5-5', 'Claude Sonnet 5.5 — alternativa mais barata para a IA que atende (06/11/2026)',
   2.00, 10.00, 2.50, 0.20, '2026-11-06')
on conflict (model) do update
  set rotulo = excluded.rotulo, entrada = excluded.entrada, saida = excluded.saida,
      escrita_de_cache = excluded.escrita_de_cache, leitura_de_cache = excluded.leitura_de_cache,
      vigente_desde = excluded.vigente_desde, updated_at = now();


-- =====================================================================
-- 2. As tabelas
-- =====================================================================

-- Onde a IA está atendendo ou foi parada. Sem linha = o que a configuração
-- disser (no treino, só a conversa do treino; com clientes, a conversa em que
-- ninguém do time escreveu).
create table if not exists public.ia_atendimento (
  conversation_id  uuid primary key references public.conversations (id) on delete cascade,
  estado           text not null check (estado in ('atendendo', 'parada')),
  motivo           text check (char_length(motivo) <= 300),
  -- Para quem a conversa foi quando a IA a passou (null = ficou com quem estava).
  passada_para     uuid references public.profiles (id) on delete set null,
  -- Quem mudou: null = a própria IA.
  mudou_por        uuid references public.profiles (id) on delete set null,
  mudou_em         timestamptz not null default now()
);
alter table public.ia_atendimento enable row level security;
drop policy if exists ia_atendimento_select on public.ia_atendimento;
create policy ia_atendimento_select on public.ia_atendimento
  for select to authenticated using ((select app.is_manager()));
comment on table public.ia_atendimento is
  'Em que conversa a IA da Imova está atendendo ou foi parada (06/11/2026). Escrita só pelas funções ia_*; sem linha vale a configuração ia.atendente.';
drop trigger if exists audit_ia_atendimento on public.ia_atendimento;
create trigger audit_ia_atendimento after insert or update or delete on public.ia_atendimento
  for each row execute function app.audit();

-- O caderno: o que a IA sabe da Imova além dos anúncios.
create table if not exists public.ia_caderno (
  id               bigint generated always as identity primary key,
  texto            text not null check (char_length(btrim(texto)) between 3 and 2000),
  -- treino: anotado pela IA na conversa de treino; correcao: veio do botão
  -- Corrigir de uma resposta; tela: escrito por alguém do time.
  origem           text not null check (origem in ('treino', 'correcao', 'tela')),
  conversation_id  uuid references public.conversations (id) on delete set null,
  message_id       uuid references public.messages (id) on delete set null,
  criado_por       uuid references public.profiles (id) on delete set null,
  criado_em        timestamptz not null default now(),
  atualizado_por   uuid references public.profiles (id) on delete set null,
  atualizado_em    timestamptz,
  ativo            boolean not null default true,
  desativado_por   uuid references public.profiles (id) on delete set null,
  desativado_em    timestamptz
);
create index if not exists ia_caderno_ativo_idx on public.ia_caderno (id) where ativo;
alter table public.ia_caderno enable row level security;
drop policy if exists ia_caderno_select on public.ia_caderno;
create policy ia_caderno_select on public.ia_caderno
  for select to authenticated using ((select app.is_manager()));
comment on table public.ia_caderno is
  'O caderno da IA que atende (Imova, 06/11/2026): instruções do treino, correções e o que a gestão escreve. A IA lê as linhas ativas a cada resposta, junto com os anúncios.';
drop trigger if exists audit_ia_caderno on public.ia_caderno;
create trigger audit_ia_caderno after insert or update or delete on public.ia_caderno
  for each row execute function app.audit();

-- Cada resposta da IA. É também a prova que a porteira confere.
create table if not exists public.ia_respostas (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.conversations (id) on delete cascade,
  -- A última mensagem do cliente que ela leu antes de responder.
  em_resposta_a    uuid references public.messages (id) on delete set null,
  -- A mensagem que saiu; null quando nada saiu (acao = nao_respondeu).
  message_id       uuid unique references public.messages (id) on delete set null,
  -- O corpo exato que foi para `messages` (com a assinatura).
  corpo            text not null check (char_length(corpo) between 1 and 1500),
  acao             text not null check (acao in ('respondeu', 'passou_para_pessoa', 'marcou_visita',
                                                 'anotou', 'nao_respondeu')),
  detalhes         jsonb not null default '{}'::jsonb,
  ai_run_id        bigint references public.ai_runs (id) on delete set null,
  prompt_version   text,
  criada_em        timestamptz not null default now(),
  avaliacao        text check (avaliacao in ('boa', 'corrigir')),
  correcao         text check (char_length(correcao) <= 2000),
  avaliada_por     uuid references public.profiles (id) on delete set null,
  avaliada_em      timestamptz,
  constraint ia_respostas_corrigir_tem_texto check (
    avaliacao is distinct from 'corrigir' or length(btrim(coalesce(correcao, ''))) > 0)
);
create index if not exists ia_respostas_conversa_idx on public.ia_respostas (conversation_id, criada_em desc);
create index if not exists ia_respostas_em_resposta_idx on public.ia_respostas (em_resposta_a);
create index if not exists ia_respostas_dia_idx on public.ia_respostas (criada_em desc);
alter table public.ia_respostas enable row level security;
drop policy if exists ia_respostas_select on public.ia_respostas;
create policy ia_respostas_select on public.ia_respostas
  for select to authenticated using ((select app.is_manager()));
comment on table public.ia_respostas is
  'Cada resposta da IA que atende (Imova, 06/11/2026): o que ela disse, a que mensagem do cliente, a ação (respondeu, passou para pessoa, marcou visita, anotou no caderno, não respondeu) e a avaliação de quem acompanha. A linha criada na mesma transação da mensagem é a prova que a porteira (messages_guard, ramo 2a) confere.';


-- =====================================================================
-- 3. A configuração e a pergunta "a IA atende esta conversa?"
-- =====================================================================
create or replace function app.ia_atendente_config()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'ligada', false,
           'modo', 'treino',
           'conversa_de_treino', null,
           'assinatura', 'Imova',
           'modelo', 'claude-opus-5-5',
           'esforco', 'low',
           'espera_seg', 15,
           'teto_por_hora', 20,
           'setor_corretores', null,
           'aviso_corretor', 'Certo! Já vou te passar para um dos nossos corretores, que continua o atendimento com você por aqui.',
           'ligada_em', null)
      || coalesce((select s.value from public.app_settings s where s.key = 'ia.atendente'), '{}'::jsonb)
$$;
comment on function app.ia_atendente_config() is
  'A configuração da IA que atende (app_settings ia.atendente) sobre os valores padrão.';
revoke all on function app.ia_atendente_config() from public, anon;
grant execute on function app.ia_atendente_config() to authenticated, service_role;

create or replace function app.ia_conversa_de_treino()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select app.uuid_seguro(app.ia_atendente_config() ->> 'conversa_de_treino')
$$;
revoke all on function app.ia_conversa_de_treino() from public, anon;
grant execute on function app.ia_conversa_de_treino() to authenticated, service_role;

-- A IA atende esta conversa agora?
--   * a chave-mestra está ligada;
--   * a conversa é de WhatsApp e não está bloqueada;
--   * ninguém a parou nesta conversa;
--   * no treino, só a conversa do treino; com clientes, qualquer uma;
--   * nenhuma pessoa do time escreveu nela desde que a IA começou ali
--     (quando gente escreve, gente assumiu). Sem linha em ia_atendimento, "desde
--     que a IA começou" é o começo da conversa: conversa em que o time já
--     falava fica com o time, a menos que alguém ligue a IA nela.
create or replace function app.ia_atende(p_conversation_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cfg   jsonb := app.ia_atendente_config();
  c       public.conversations%rowtype;
  a       public.ia_atendimento%rowtype;
  v_desde timestamptz;
begin
  if not coalesce((v_cfg ->> 'ligada')::boolean, false) then
    return false;
  end if;
  select * into c from public.conversations where id = p_conversation_id;
  if not found or c.channel <> 'whatsapp'::app.channel or c.bloqueada_em is not null then
    return false;
  end if;
  select * into a from public.ia_atendimento where conversation_id = p_conversation_id;
  if a.estado = 'parada' then
    return false;
  end if;
  if c.id is distinct from app.ia_conversa_de_treino()
     and coalesce(v_cfg ->> 'modo', 'treino') <> 'clientes' then
    return false;
  end if;
  v_desde := coalesce(a.mudou_em, '-infinity'::timestamptz);
  if exists (select 1 from public.messages m
              where m.conversation_id = p_conversation_id
                and m.direction = 'out'::app.msg_direction
                and m.author_kind = 'human'
                and m.created_at > v_desde) then
    return false;
  end if;
  return true;
end $$;
comment on function app.ia_atende(uuid) is
  'A IA que atende (Imova) responde nesta conversa agora? Chave ligada, WhatsApp, não bloqueada, não parada, do treino (ou modo clientes) e sem mensagem de gente do time desde que a IA começou ali.';
revoke all on function app.ia_atende(uuid) from public, anon;
grant execute on function app.ia_atende(uuid) to authenticated, service_role;

-- A prova que a porteira confere: o mesmo corpo, registrado NESTA transação
-- por `app.ia_atendente_dizer`, ainda sem mensagem, numa conversa em que a IA
-- atende. Quem não passa pela função não tem como criar a linha (RLS sem
-- escrita), e `now()` é o começo da transação.
create or replace function app.ia_atendente_autoriza(p_conversation_id uuid, p_body text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
           select 1 from public.ia_respostas r
            where r.conversation_id = p_conversation_id
              and r.message_id is null
              and r.acao <> 'nao_respondeu'
              and r.corpo = p_body
              and r.criada_em = now())
     and app.ia_atende(p_conversation_id)
$$;
comment on function app.ia_atendente_autoriza(uuid, text) is
  'A porteira (messages_guard, ramo 2a) deixa sair bot_ai sem rascunho só quando esta função diz sim: corpo registrado em ia_respostas nesta transação, numa conversa em que a IA atende.';
revoke all on function app.ia_atendente_autoriza(uuid, text) from public, anon, authenticated;

-- "Quero falar com um corretor": decidido por regra, sem esperar o modelo.
create or replace function app.ia_pediu_corretor(p_texto text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  with t as (
    select regexp_replace(lower(extensions.unaccent(coalesce(p_texto, ''))), '\s+', ' ', 'g') as x
  )
  select t.x ~ '\m(falar|conversar|atendimento|atender|passa|passar|chama|chamar|quero|queria|gostaria|preciso|tem)\M.{0,30}\m(corretor|corretora|atendente|humano|pessoa de verdade|pessoa real|alguem da equipe|alguem de verdade)\M'
      or btrim(t.x, ' .!?') in ('corretor', 'corretora', 'atendente', 'humano', 'falar com corretor',
                                'falar com atendente', 'falar com humano')
    from t
$$;
comment on function app.ia_pediu_corretor(text) is
  'Regra: o cliente pediu para falar com um corretor (ou atendente, ou humano). A IA avisa que vai passar e passa, sem chamar o modelo.';
revoke all on function app.ia_pediu_corretor(text) from public, anon;
grant execute on function app.ia_pediu_corretor(text) to authenticated, service_role;


-- =====================================================================
-- 4. O que a IA sabe: o caderno e os imóveis
-- =====================================================================
-- Os imóveis vêm da aba Anúncios (`public.anuncios`) e dos anúncios feitos à
-- mão no Canal Pro (`public.anuncios_no_canal_pro`), quando essas tabelas
-- existem. A leitura é dinâmica e por `to_jsonb`: coluna que mudar de nome
-- some da lista em vez de derrubar a IA, e erro vira lista vazia com aviso.
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
                 'descricao',       left(nullif(j ->> 'descricao', ''), 900))
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
      execute $q$
        select coalesce(jsonb_agg(jsonb_build_object(
                 'codigo',        j ->> 'codigo',
                 'situacao',      'no_ar',
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
      $q$ into v_manual;
    exception when others then
      raise warning 'ia_atendente_imoveis: não consegui ler public.anuncios_no_canal_pro: %', sqlerrm;
      v_manual := '[]'::jsonb;
    end;
  end if;

  return v_crm || v_manual;
end $$;
comment on function app.ia_atendente_imoveis() is
  'Os imóveis que a IA que atende conhece: os da aba Anúncios (menos os excluídos) e os anúncios feitos à mão no Canal Pro que ainda não vieram para o CRM. Endereço só até onde o anúncio mostra.';
revoke all on function app.ia_atendente_imoveis() from public, anon, authenticated;

-- A base da IA: o caderno e os imóveis, em ordem estável (é o bloco que vai
-- para o cache do modelo, e qualquer byte diferente invalida o cache).
create or replace function public.ia_atendente_base()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caderno jsonb;
  v_imoveis jsonb := app.ia_atendente_imoveis();
begin
  select coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'texto', k.texto, 'origem', k.origem)
                            order by k.id), '[]'::jsonb)
    into v_caderno
    from public.ia_caderno k
   where k.ativo;
  return jsonb_build_object(
    'assinatura', app.ia_atendente_config() ->> 'assinatura',
    'caderno', v_caderno,
    'imoveis', v_imoveis,
    -- Para o registro: com que base a resposta foi escrita.
    'versao', jsonb_build_object(
      'caderno_ate', (select max(k.id) from public.ia_caderno k),
      'caderno_ativos', jsonb_array_length(v_caderno),
      'caderno_mudou_em', (select max(greatest(k.criado_em, k.atualizado_em, k.desativado_em))
                             from public.ia_caderno k),
      'imoveis', jsonb_array_length(v_imoveis)));
end $$;
comment on function public.ia_atendente_base() is
  'Porta do worker de IA: o caderno ativo e os imóveis que a IA que atende conhece (Imova).';
revoke all on function public.ia_atendente_base() from public, anon, authenticated;
grant execute on function public.ia_atendente_base() to service_role;


-- =====================================================================
-- 5. A entrada da IA que atende
-- =====================================================================
create or replace function public.ia_entrada_do_atendente(p_conversation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c          public.conversations%rowtype;
  v_org      public.organizations%rowtype;
  v_deal     uuid;
  v_ultima   public.messages%rowtype;
  v_msgs     jsonb;
  v_horarios jsonb := '[]'::jsonb;
  v_canal    text;
  v_agora    timestamptz := now();
  v_dono     uuid;
begin
  select * into c from public.conversations where id = p_conversation_id;
  if not found then
    return jsonb_build_object('existe', false);
  end if;
  if c.organization_id is not null then
    select * into v_org from public.organizations where id = c.organization_id;
    v_deal := coalesce(c.deal_id, app.wa_negocio_da_ficha(c.organization_id));
  end if;

  select * into v_ultima from public.messages m
   where m.conversation_id = p_conversation_id
     and m.direction = 'in'::app.msg_direction
     and m.type not in ('reaction'::app.msg_type, 'system'::app.msg_type)
   order by m.created_at desc, m.id desc
   limit 1;

  -- As 40 mais recentes, em ordem de conversa.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', x.id, 'de', x.de, 'quem', x.quem, 'quando', x.quando, 'texto', x.texto)
         order by x.created_at, x.id), '[]'::jsonb)
    into v_msgs
    from (
      select m.id, m.created_at,
             case when m.direction = 'in'::app.msg_direction then 'cliente'
                  when m.author_kind = 'bot_ai' then 'ia'
                  when m.author_kind = 'human' then 'equipe'
                  else 'sistema' end as de,
             case when m.direction = 'out'::app.msg_direction and m.author_kind = 'human'
                  then app.primeiro_nome(m.sent_by) end as quem,
             to_char(m.created_at at time zone 'America/Fortaleza', 'DD/MM HH24:MI') as quando,
             left(case
               when m.apagada_em is not null or m.apagada_pelo_contato_em is not null then '[mensagem apagada]'
               when m.type = 'audio'::app.msg_type then
                 coalesce('[áudio] ' || nullif(btrim(m.transcript), ''), '[áudio sem transcrição: não dá para ouvir]')
               when m.type = 'image'::app.msg_type then
                 '[foto]' || coalesce(' ' || nullif(btrim(m.body), ''), '')
               when m.type = 'video'::app.msg_type then
                 '[vídeo]' || coalesce(' ' || nullif(btrim(m.body), ''), '')
               when m.type = 'document'::app.msg_type then
                 '[documento' || coalesce(': ' || m.media_nome, '') || ']' || coalesce(' ' || nullif(btrim(m.body), ''), '')
               when m.type = 'location'::app.msg_type then '[localização]'
               when m.type = 'contacts'::app.msg_type then '[cartão de contato]'
               when m.author_kind = 'bot_ai' then coalesce(app.sem_assinatura(m.body), m.body)
               when m.direction = 'out'::app.msg_direction then coalesce(app.sem_assinatura(m.body), m.body)
               else coalesce(nullif(btrim(m.body), ''), m.transcript, '[mensagem sem texto]')
             end, 2000) as texto
        from public.messages m
       where m.conversation_id = p_conversation_id
         and m.type not in ('reaction'::app.msg_type, 'system'::app.msg_type)
         and not (m.direction = 'out'::app.msg_direction and m.status = 'failed'::app.msg_status)
       order by m.created_at desc, m.id desc
       limit 40
    ) x;

  -- Os horários livres de visita: os da agenda de quem atende a conversa (a
  -- mesma regra de `app.reuniao_gravar`). Sem ficha não há como marcar.
  if c.organization_id is not null then
    select coalesce(d.owner_id, c.assignee_id) into v_dono
      from (select 1) um left join public.deals d on d.id = v_deal;
    v_horarios := coalesce(app.reuniao_opcoes(v_dono, 8), '[]'::jsonb);
  end if;

  -- O canal de chegada, quando o módulo existe (a outra branch, 06/11/2026).
  if to_regclass('public.chegadas') is not null then
    begin
      execute $q$
        select coalesce(j ->> 'canal_marcado', j ->> 'canal_automatico')
          from (select to_jsonb(ch) as j from public.chegadas ch
                 where ch.conversation_id = $1) s
         order by (j ->> 'created_at') desc nulls last
         limit 1
      $q$ into v_canal using p_conversation_id;
    exception when others then
      v_canal := null;
    end;
  end if;

  return jsonb_build_object(
    'existe', true,
    'conversation_id', c.id,
    'organization_id', c.organization_id,
    'contact_id', c.contact_id,
    'treino', c.id is not distinct from app.ia_conversa_de_treino(),
    'atende', app.ia_atende(c.id),
    'agora', to_char(v_agora at time zone 'America/Fortaleza', 'YYYY-MM-DD HH24:MI'),
    'agora_por_extenso', app.reuniao_por_extenso(v_agora),
    'cliente', jsonb_build_object(
      'nome', coalesce(nullif(btrim(v_org.name), ''), nullif(btrim(c.peer_nome), '')),
      'tem_ficha', c.organization_id is not null,
      'etapa', (select s.name from public.deals d join public.stages s on s.id = d.stage_id where d.id = v_deal),
      'perfil', coalesce((
        select jsonb_agg(jsonb_build_object('campo', e.key, 'valor', e.value ->> 'valor') order by e.key)
          from public.ficha_da_conversa f, jsonb_each(coalesce(f.dados_extraidos, '{}'::jsonb)) e
         where f.conversation_id = c.id and coalesce(e.value ->> 'valor', '') <> ''), '[]'::jsonb),
      'visitas', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'quando', app.reuniao_por_extenso(r.inicio), 'estado', r.estado, 'local', r.local)
               order by r.inicio)
          from (select rn.inicio, rn.estado, rn.local from public.reunioes rn
                 where c.organization_id is not null and rn.organization_id = c.organization_id
                   and rn.inicio > v_agora - interval '30 days'
                 order by rn.inicio desc limit 5) r), '[]'::jsonb),
      'canal_de_chegada', v_canal),
    'horarios_de_visita', v_horarios,
    'ultima_do_cliente', v_ultima.id,
    'ultima_do_cliente_em', v_ultima.created_at,
    'respostas_na_ultima_hora', (select count(*) from public.ia_respostas r
                                  where r.conversation_id = c.id and r.message_id is not null
                                    and r.criada_em > v_agora - interval '1 hour'),
    'mensagens', v_msgs);
end $$;
comment on function public.ia_entrada_do_atendente(uuid) is
  'Porta do worker de IA: o que a IA que atende lê de uma conversa (Imova): as 40 mensagens mais recentes, o cliente (ficha, etapa, perfil, visitas, canal de chegada), os horários livres de visita e se é a conversa do treino.';
revoke all on function public.ia_entrada_do_atendente(uuid) from public, anon, authenticated;
grant execute on function public.ia_entrada_do_atendente(uuid) to service_role;


-- =====================================================================
-- 6. A IA diz: o único jeito de um texto dela virar mensagem
-- =====================================================================
create or replace function app.ia_atendente_dizer(
  p_conversation_id uuid, p_em_resposta_a uuid, p_texto text, p_acao text,
  p_detalhes jsonb default '{}'::jsonb, p_ai_run_id bigint default null,
  p_prompt_version text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_cfg    jsonb := app.ia_atendente_config();
  v_texto  text := btrim(coalesce(p_texto, ''));
  v_assin  text := nullif(btrim(coalesce(v_cfg ->> 'assinatura', '')), '');
  v_teto   int := greatest(coalesce((v_cfg ->> 'teto_por_hora')::int, 20), 1);
  v_corpo  text;
  v_ultima uuid;
  v_hora   int;
  v_resp   uuid;
  v_msg    uuid;
begin
  if p_acao not in ('respondeu', 'passou_para_pessoa', 'marcou_visita', 'anotou') then
    raise exception 'ação % não é de quem fala', p_acao using errcode = '22023';
  end if;
  perform 1 from public.conversations where id = p_conversation_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'conversa_nao_existe');
  end if;
  if not app.ia_atende(p_conversation_id) then
    return jsonb_build_object('ok', false, 'motivo', 'ia_nao_atende');
  end if;
  if v_texto = '' then
    return jsonb_build_object('ok', false, 'motivo', 'texto_vazio');
  end if;
  if char_length(v_texto) > 1200 then
    return jsonb_build_object('ok', false, 'motivo', 'texto_longo_demais');
  end if;

  -- Chegou mensagem do cliente depois da que ela leu? Então a resposta está
  -- velha: não sai, e a próxima rodada lê tudo de novo.
  select m.id into v_ultima from public.messages m
   where m.conversation_id = p_conversation_id
     and m.direction = 'in'::app.msg_direction
     and m.type not in ('reaction'::app.msg_type, 'system'::app.msg_type)
   order by m.created_at desc, m.id desc
   limit 1;
  if p_em_resposta_a is not null and v_ultima is distinct from p_em_resposta_a then
    return jsonb_build_object('ok', false, 'motivo', 'chegou_mensagem_nova');
  end if;
  if p_em_resposta_a is not null and exists (
       select 1 from public.ia_respostas r
        where r.em_resposta_a = p_em_resposta_a and r.message_id is not null) then
    return jsonb_build_object('ok', false, 'motivo', 'ja_respondida');
  end if;

  -- O teto de fala: robô que conversa com robô (aviso automático de outra
  -- empresa) não pode virar pingue-pongue.
  select count(*) into v_hora from public.ia_respostas r
   where r.conversation_id = p_conversation_id and r.message_id is not null
     and r.criada_em > now() - interval '1 hour';
  if v_hora >= v_teto then
    return jsonb_build_object('ok', false, 'motivo', 'teto_por_hora');
  end if;

  v_corpo := case when v_assin is null then v_texto
                  else '*' || v_assin || ':*' || E'\n' || v_texto end;

  begin
    insert into public.ia_respostas (conversation_id, em_resposta_a, corpo, acao, detalhes,
                                     ai_run_id, prompt_version)
    values (p_conversation_id, p_em_resposta_a, v_corpo, p_acao, coalesce(p_detalhes, '{}'::jsonb),
            p_ai_run_id, p_prompt_version)
    returning id into v_resp;

    insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin)
    values (p_conversation_id, 'out'::app.msg_direction, 'text'::app.msg_type,
            'queued'::app.msg_status, v_corpo, 'bot_ai', 'crm')
    returning id into v_msg;

    update public.ia_respostas set message_id = v_msg where id = v_resp;
  exception when others then
    -- A porteira recusou (contato suprimido, janela fechada, teto...): nada
    -- sai, e fica o registro do porquê.
    insert into public.ia_respostas (conversation_id, em_resposta_a, corpo, acao, detalhes,
                                     ai_run_id, prompt_version)
    values (p_conversation_id, p_em_resposta_a, left(v_corpo, 1500), 'nao_respondeu',
            coalesce(p_detalhes, '{}'::jsonb)
              || jsonb_build_object('quis', p_acao, 'motivo', 'porteira', 'erro', left(sqlerrm, 300)),
            p_ai_run_id, p_prompt_version);
    return jsonb_build_object('ok', false, 'motivo', 'porteira', 'erro', sqlerrm);
  end;

  return jsonb_build_object('ok', true, 'message_id', v_msg, 'resposta_id', v_resp);
end $$;
comment on function app.ia_atendente_dizer(uuid, uuid, text, text, jsonb, bigint, text) is
  'O único caminho de um texto da IA que atende até messages: confere que ela atende a conversa, que não chegou mensagem nova do cliente, que aquela mensagem ainda não foi respondida e o teto por hora; registra em ia_respostas (a prova da porteira) e insere a mensagem assinada, em fila.';
revoke all on function app.ia_atendente_dizer(uuid, uuid, text, text, jsonb, bigint, text) from public, anon, authenticated;

create or replace function public.ia_atendente_responder(
  p_conversation_id uuid, p_em_resposta_a uuid, p_texto text,
  p_detalhes jsonb default '{}'::jsonb, p_ai_run_id bigint default null,
  p_prompt_version text default null)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select app.ia_atendente_dizer(p_conversation_id, p_em_resposta_a, p_texto, 'respondeu',
                                p_detalhes, p_ai_run_id, p_prompt_version)
$$;
comment on function public.ia_atendente_responder(uuid, uuid, text, jsonb, bigint, text) is
  'Porta do worker de IA: a IA que atende responde ao cliente.';
revoke all on function public.ia_atendente_responder(uuid, uuid, text, jsonb, bigint, text) from public, anon, authenticated;
grant execute on function public.ia_atendente_responder(uuid, uuid, text, jsonb, bigint, text) to service_role;

-- A IA leu e não disse nada (cortesia sem resposta, erro do modelo, PII na
-- entrada): fica o registro, e a mesma mensagem não volta para a fila.
create or replace function public.ia_atendente_registrar_silencio(
  p_conversation_id uuid, p_em_resposta_a uuid, p_motivo text,
  p_detalhes jsonb default '{}'::jsonb, p_ai_run_id bigint default null,
  p_prompt_version text default null)
returns uuid
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.ia_respostas (conversation_id, em_resposta_a, corpo, acao, detalhes, ai_run_id, prompt_version)
  values (p_conversation_id, p_em_resposta_a, '—', 'nao_respondeu',
          coalesce(p_detalhes, '{}'::jsonb) || jsonb_build_object('motivo', left(coalesce(p_motivo, ''), 200)),
          p_ai_run_id, p_prompt_version)
  returning id
$$;
revoke all on function public.ia_atendente_registrar_silencio(uuid, uuid, text, jsonb, bigint, text) from public, anon, authenticated;
grant execute on function public.ia_atendente_registrar_silencio(uuid, uuid, text, jsonb, bigint, text) to service_role;


-- =====================================================================
-- 7. Parar, passar para gente e voltar
-- =====================================================================
create or replace function app.ia_atendente_mudar(
  p_conversation_id uuid, p_estado text, p_motivo text, p_por uuid, p_para uuid default null)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.ia_atendimento (conversation_id, estado, motivo, passada_para, mudou_por, mudou_em)
  values (p_conversation_id, p_estado, left(nullif(btrim(coalesce(p_motivo, '')), ''), 300), p_para, p_por, now())
  on conflict (conversation_id) do update
    set estado = excluded.estado, motivo = excluded.motivo, passada_para = excluded.passada_para,
        mudou_por = excluded.mudou_por, mudou_em = excluded.mudou_em
$$;
revoke all on function app.ia_atendente_mudar(uuid, text, text, uuid, uuid) from public, anon, authenticated;

-- A IA entrega a conversa: para, passa a quem recebe no setor dos corretores
-- (quando configurado; senão fica com quem está) e abre uma tarefa para agora.
create or replace function app.ia_atendente_entregar(p_conversation_id uuid, p_motivo text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_cfg   jsonb := app.ia_atendente_config();
  v_setor int := (v_cfg ->> 'setor_corretores')::int;
  c       public.conversations%rowtype;
  v_para  uuid;
  v_nome  text;
begin
  select * into c from public.conversations where id = p_conversation_id for update;
  if not found then
    return null;
  end if;
  if v_setor is not null
     and exists (select 1 from public.setores s where s.id = v_setor and s.ativo) then
    v_para := app.setor_quem_recebe(v_setor);
  end if;
  v_para := coalesce(v_para, c.assignee_id);

  perform app.ia_atendente_mudar(p_conversation_id, 'parada', coalesce(p_motivo, 'a IA passou para uma pessoa'),
                                 null, v_para);

  if v_para is distinct from c.assignee_id or (v_setor is not null and c.setor_id is distinct from v_setor) then
    update public.conversations
       set assignee_id = v_para, setor_id = coalesce(v_setor, setor_id), updated_at = now()
     where id = c.id;
  end if;

  v_nome := coalesce((select o.name from public.organizations o where o.id = c.organization_id),
                     nullif(btrim(c.peer_nome), ''), 'cliente');
  begin
    insert into public.tasks (title, kind, priority, due_at, assignee_id, organization_id, contact_id, origin)
    values (left('A IA passou o cliente para você: ' || v_nome
                 || coalesce(' — ' || nullif(btrim(coalesce(p_motivo, '')), ''), ''), 300),
            'message'::app.task_kind, 1, now(), v_para, c.organization_id, c.contact_id, 'system');
  exception when others then
    -- Contato suprimido não ganha tarefa (o gatilho de tasks recusa); a
    -- conversa já está parada e com a pessoa, e isso basta.
    raise warning 'ia_atendente_entregar: tarefa não criada: %', sqlerrm;
  end;
  return v_para;
end $$;
revoke all on function app.ia_atendente_entregar(uuid, text) from public, anon, authenticated;

-- O worker: avisa o cliente (o texto da IA ou o aviso padrão) e passa.
create or replace function public.ia_atendente_passar(
  p_conversation_id uuid, p_em_resposta_a uuid, p_texto text, p_motivo text,
  p_ai_run_id bigint default null, p_prompt_version text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_texto text := coalesce(nullif(btrim(coalesce(p_texto, '')), ''),
                           app.ia_atendente_config() ->> 'aviso_corretor');
  v_disse jsonb;
  v_para  uuid;
begin
  v_disse := app.ia_atendente_dizer(p_conversation_id, p_em_resposta_a, v_texto, 'passou_para_pessoa',
                                    jsonb_build_object('motivo', left(coalesce(p_motivo, ''), 300)),
                                    p_ai_run_id, p_prompt_version);
  -- Chegou mensagem nova: a próxima rodada decide de novo (pode ser outra coisa).
  if v_disse ->> 'motivo' in ('chegou_mensagem_nova', 'ja_respondida', 'conversa_nao_existe') then
    return v_disse;
  end if;
  -- Disse ou não (porteira, teto), a conversa vai para gente.
  if app.ia_atende(p_conversation_id) or coalesce((v_disse ->> 'ok')::boolean, false) then
    v_para := app.ia_atendente_entregar(p_conversation_id, p_motivo);
  end if;
  return v_disse || jsonb_build_object('passada_para', v_para);
end $$;
comment on function public.ia_atendente_passar(uuid, uuid, text, text, bigint, text) is
  'Porta do worker de IA: a IA avisa o cliente que vai passar (texto dela ou o aviso padrão) e entrega a conversa a uma pessoa, com tarefa para agora.';
revoke all on function public.ia_atendente_passar(uuid, uuid, text, text, bigint, text) from public, anon, authenticated;
grant execute on function public.ia_atendente_passar(uuid, uuid, text, text, bigint, text) to service_role;

-- A tela: o colaborador para a IA numa conversa (e passa por "Transferir").
create or replace function public.ia_conversa_parar(p_conversation_id uuid, p_motivo text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not app.is_manager() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if not exists (select 1 from public.conversations c where c.id = p_conversation_id) then
    return jsonb_build_object('ok', false, 'motivo', 'conversa_inexistente');
  end if;
  perform app.ia_atendente_mudar(p_conversation_id, 'parada',
                                 coalesce(nullif(btrim(coalesce(p_motivo, '')), ''), 'parada por uma pessoa'),
                                 auth.uid(), null);
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.ia_conversa_parar(uuid, text) from public, anon;
grant execute on function public.ia_conversa_parar(uuid, text) to authenticated;

create or replace function public.ia_conversa_ligar(p_conversation_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not app.is_manager() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if not exists (select 1 from public.conversations c where c.id = p_conversation_id) then
    return jsonb_build_object('ok', false, 'motivo', 'conversa_inexistente');
  end if;
  perform app.ia_atendente_mudar(p_conversation_id, 'atendendo', 'ligada por uma pessoa', auth.uid(), null);
  return jsonb_build_object('ok', true, 'atende', app.ia_atende(p_conversation_id));
end $$;
revoke all on function public.ia_conversa_ligar(uuid) from public, anon;
grant execute on function public.ia_conversa_ligar(uuid) to authenticated;

-- O que a tela mostra no cabeçalho da conversa.
create or replace function public.ia_conversa_estado(p_conversation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cfg jsonb := app.ia_atendente_config();
  a     public.ia_atendimento%rowtype;
begin
  if auth.uid() is null or not app.is_manager() then
    return jsonb_build_object('existe', false);
  end if;
  select * into a from public.ia_atendimento where conversation_id = p_conversation_id;
  return jsonb_build_object(
    'existe', true,
    'ligada', coalesce((v_cfg ->> 'ligada')::boolean, false),
    'modo', v_cfg ->> 'modo',
    'treino', p_conversation_id is not distinct from app.ia_conversa_de_treino(),
    'atende', app.ia_atende(p_conversation_id),
    'estado', a.estado,
    'motivo', a.motivo,
    'mudou_em', a.mudou_em,
    'mudou_por', app.primeiro_nome(a.mudou_por),
    'passada_para', app.primeiro_nome(a.passada_para));
end $$;
revoke all on function public.ia_conversa_estado(uuid) from public, anon;
grant execute on function public.ia_conversa_estado(uuid) to authenticated;


-- =====================================================================
-- 8. A visita
-- =====================================================================
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
  return v_disse || jsonb_build_object('reuniao', v_r);
end $$;
comment on function public.ia_atendente_marcar_visita(uuid, uuid, timestamptz, text, text, bigint, text) is
  'Porta do worker de IA: marca a visita (app.reuniao_gravar, presencial, no endereço do imóvel quando o anúncio o mostra, origem robô) e manda a confirmação na mesma transação. Se a confirmação não sair, a visita é desfeita.';
revoke all on function public.ia_atendente_marcar_visita(uuid, uuid, timestamptz, text, text, bigint, text) from public, anon, authenticated;
grant execute on function public.ia_atendente_marcar_visita(uuid, uuid, timestamptz, text, text, bigint, text) to service_role;


-- =====================================================================
-- 9. O caderno
-- =====================================================================
-- O treino: só na conversa do treino, a IA anota o que a pessoa ensinou.
create or replace function public.ia_atendente_anotar(
  p_conversation_id uuid, p_message_id uuid, p_textos text[])
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_texto text;
  v_n     int := 0;
begin
  if p_conversation_id is distinct from app.ia_conversa_de_treino() then
    raise exception 'Só a conversa do treino anota no caderno da IA' using errcode = '42501';
  end if;
  foreach v_texto in array coalesce(p_textos, '{}'::text[]) loop
    v_texto := btrim(coalesce(v_texto, ''));
    continue when char_length(v_texto) < 3;
    insert into public.ia_caderno (texto, origem, conversation_id, message_id)
    values (left(v_texto, 2000), 'treino', p_conversation_id, p_message_id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function public.ia_atendente_anotar(uuid, uuid, text[]) from public, anon, authenticated;
grant execute on function public.ia_atendente_anotar(uuid, uuid, text[]) to service_role;

create or replace function public.ia_caderno_escrever(p_texto text, p_id bigint default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_texto text := btrim(coalesce(p_texto, ''));
  v_id    bigint;
begin
  if auth.uid() is null or not app.is_manager() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if char_length(v_texto) < 3 then
    return jsonb_build_object('ok', false, 'motivo', 'texto_curto');
  end if;
  if char_length(v_texto) > 2000 then
    return jsonb_build_object('ok', false, 'motivo', 'texto_longo');
  end if;
  if p_id is null then
    insert into public.ia_caderno (texto, origem, criado_por)
    values (v_texto, 'tela', auth.uid()) returning id into v_id;
  else
    update public.ia_caderno
       set texto = v_texto, atualizado_por = auth.uid(), atualizado_em = now()
     where id = p_id and ativo
    returning id into v_id;
    if v_id is null then
      return jsonb_build_object('ok', false, 'motivo', 'linha_inexistente');
    end if;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
revoke all on function public.ia_caderno_escrever(text, bigint) from public, anon;
grant execute on function public.ia_caderno_escrever(text, bigint) to authenticated;

create or replace function public.ia_caderno_tirar(p_id bigint)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not app.is_manager() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  update public.ia_caderno
     set ativo = false, desativado_por = auth.uid(), desativado_em = now()
   where id = p_id and ativo;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'linha_inexistente');
  end if;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.ia_caderno_tirar(bigint) from public, anon;
grant execute on function public.ia_caderno_tirar(bigint) to authenticated;

-- Boa / Corrigir. A correção vira linha do caderno.
create or replace function public.ia_resposta_avaliar(p_resposta_id uuid, p_avaliacao text,
                                                      p_correcao text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r          public.ia_respostas%rowtype;
  v_corr     text := nullif(btrim(coalesce(p_correcao, '')), '');
  v_cliente  text;
  v_disse    text;
  v_caderno  bigint;
begin
  if auth.uid() is null or not app.is_manager() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if p_avaliacao not in ('boa', 'corrigir') then
    return jsonb_build_object('ok', false, 'motivo', 'avaliacao_invalida');
  end if;
  if p_avaliacao = 'corrigir' and v_corr is null then
    return jsonb_build_object('ok', false, 'motivo', 'sem_correcao');
  end if;
  if v_corr is not null and char_length(v_corr) > 1500 then
    return jsonb_build_object('ok', false, 'motivo', 'correcao_longa');
  end if;
  select * into r from public.ia_respostas where id = p_resposta_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'resposta_inexistente');
  end if;

  update public.ia_respostas
     set avaliacao = p_avaliacao,
         correcao = case when p_avaliacao = 'corrigir' then v_corr end,
         avaliada_por = auth.uid(), avaliada_em = now()
   where id = r.id;

  if p_avaliacao = 'corrigir' then
    select left(coalesce(nullif(btrim(m.body), ''), m.transcript, ''), 300) into v_cliente
      from public.messages m where m.id = r.em_resposta_a;
    v_disse := left(coalesce(app.sem_assinatura(r.corpo), r.corpo), 300);
    insert into public.ia_caderno (texto, origem, conversation_id, message_id, criado_por)
    values (left(
              'Correção de uma resposta: '
              || coalesce('quando o cliente escreveu "' || nullif(v_cliente, '') || '", ', '')
              || 'você respondeu "' || v_disse || '". O certo era: ' || v_corr, 2000),
            'correcao', r.conversation_id, r.message_id, auth.uid())
    returning id into v_caderno;
  end if;
  return jsonb_build_object('ok', true, 'caderno_id', v_caderno);
end $$;
revoke all on function public.ia_resposta_avaliar(uuid, text, text) from public, anon;
grant execute on function public.ia_resposta_avaliar(uuid, text, text) to authenticated;


-- =====================================================================
-- 10. A configuração pela tela e o placar
-- =====================================================================
create or replace function public.ia_atendente_configurar(p_valores jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_atual  jsonb := coalesce((select s.value from public.app_settings s where s.key = 'ia.atendente'), '{}'::jsonb);
  v_novo   jsonb := v_atual;
  v_chave  text;
  v_valor  jsonb;
  v_treino uuid;
begin
  if auth.uid() is null or not app.admin_ou_gestor() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  for v_chave, v_valor in select * from jsonb_each(coalesce(p_valores, '{}'::jsonb)) loop
    case v_chave
      when 'ligada' then
        if jsonb_typeof(v_valor) <> 'boolean' then
          return jsonb_build_object('ok', false, 'motivo', 'ligada_nao_e_sim_ou_nao');
        end if;
        if (v_valor)::text::boolean and not coalesce((v_atual ->> 'ligada')::boolean, false) then
          v_novo := v_novo || jsonb_build_object('ligada_em', now());
        end if;
      when 'modo' then
        if v_valor #>> '{}' not in ('treino', 'clientes') then
          return jsonb_build_object('ok', false, 'motivo', 'modo_invalido');
        end if;
      when 'conversa_de_treino' then
        if jsonb_typeof(v_valor) <> 'null' then
          v_treino := app.uuid_seguro(v_valor #>> '{}');
          if v_treino is null or not exists (select 1 from public.conversations c where c.id = v_treino) then
            return jsonb_build_object('ok', false, 'motivo', 'conversa_inexistente');
          end if;
        end if;
      when 'setor_corretores' then
        if jsonb_typeof(v_valor) <> 'null'
           and not exists (select 1 from public.setores s where s.id = (v_valor #>> '{}')::int) then
          return jsonb_build_object('ok', false, 'motivo', 'setor_inexistente');
        end if;
      when 'assinatura' then
        if char_length(coalesce(v_valor #>> '{}', '')) > 40 then
          return jsonb_build_object('ok', false, 'motivo', 'assinatura_longa');
        end if;
      when 'aviso_corretor' then
        if char_length(btrim(coalesce(v_valor #>> '{}', ''))) not between 10 and 400 then
          return jsonb_build_object('ok', false, 'motivo', 'aviso_fora_do_tamanho');
        end if;
      when 'modelo' then
        if v_valor #>> '{}' not in ('claude-opus-5-5', 'claude-sonnet-5-5') then
          return jsonb_build_object('ok', false, 'motivo', 'modelo_invalido');
        end if;
      when 'esforco' then
        if v_valor #>> '{}' not in ('low', 'medium', 'high') then
          return jsonb_build_object('ok', false, 'motivo', 'esforco_invalido');
        end if;
      when 'espera_seg' then
        if jsonb_typeof(v_valor) <> 'number' or (v_valor)::text::numeric not between 5 and 300 then
          return jsonb_build_object('ok', false, 'motivo', 'espera_fora_do_limite');
        end if;
      when 'teto_por_hora' then
        if jsonb_typeof(v_valor) <> 'number' or (v_valor)::text::numeric not between 1 and 60 then
          return jsonb_build_object('ok', false, 'motivo', 'teto_fora_do_limite');
        end if;
      else
        return jsonb_build_object('ok', false, 'motivo', 'chave_desconhecida', 'chave', v_chave);
    end case;
    v_novo := v_novo || jsonb_build_object(v_chave, v_valor);
  end loop;

  insert into public.app_settings (key, value, description)
  values ('ia.atendente', v_novo,
          'A IA que atende o cliente sozinha (Imova, 06/11/2026). Mudada pela tela (public.ia_atendente_configurar).')
  on conflict (key) do update set value = excluded.value;

  -- A conversa do treino nasce com a IA ligada nela (o time já tinha falado
  -- com o Janio; sem isso, "gente escreveu" a deixaria parada).
  if v_treino is not null then
    perform app.ia_atendente_mudar(v_treino, 'atendendo', 'conversa do treino', auth.uid(), null);
  end if;
  return jsonb_build_object('ok', true, 'config', app.ia_atendente_config());
end $$;
revoke all on function public.ia_atendente_configurar(jsonb) from public, anon;
grant execute on function public.ia_atendente_configurar(jsonb) to authenticated;

create or replace function public.ia_atendente_painel(p_dias int default 7)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_desde timestamptz := now() - make_interval(days => greatest(least(coalesce(p_dias, 7), 90), 1));
  v_treino uuid := app.ia_conversa_de_treino();
begin
  if auth.uid() is null or not app.is_manager() then
    return jsonb_build_object('existe', false);
  end if;
  return jsonb_build_object(
    'existe', true,
    'config', app.ia_atendente_config(),
    'pode_configurar', app.admin_ou_gestor(),
    'conversa_de_treino', (
      select jsonb_build_object('id', c.id, 'organization_id', c.organization_id,
               'nome', coalesce(o.name, c.peer_nome, c.peer_phone_e164))
        from public.conversations c left join public.organizations o on o.id = c.organization_id
       where c.id = v_treino),
    'placar', (
      select jsonb_build_object(
               'respostas',   count(*) filter (where r.message_id is not null),
               'boas',        count(*) filter (where r.avaliacao = 'boa'),
               'corrigidas',  count(*) filter (where r.avaliacao = 'corrigir'),
               'sem_avaliacao', count(*) filter (where r.message_id is not null and r.avaliacao is null),
               'passadas',    count(*) filter (where r.acao = 'passou_para_pessoa' and r.message_id is not null),
               'visitas',     count(*) filter (where r.acao = 'marcou_visita' and r.message_id is not null),
               'silencios',   count(*) filter (where r.acao = 'nao_respondeu'),
               'conversas',   count(distinct r.conversation_id) filter (where r.message_id is not null),
               'no_treino',   count(*) filter (where r.message_id is not null and r.conversation_id = v_treino))
        from public.ia_respostas r where r.criada_em >= v_desde),
    'custo_usd', (select coalesce(round(sum(a.cost_usd)::numeric, 4), 0)
                    from public.ai_runs a
                   where a.purpose = 'draft_reply' and a.prompt_version like 'atendente-imova@%'
                     and a.created_at >= v_desde),
    'caderno', (select jsonb_build_object('ativas', count(*) filter (where k.ativo),
                                          'do_treino', count(*) filter (where k.ativo and k.origem = 'treino'),
                                          'correcoes', count(*) filter (where k.ativo and k.origem = 'correcao'))
                  from public.ia_caderno k),
    'imoveis', jsonb_array_length(app.ia_atendente_imoveis()));
end $$;
revoke all on function public.ia_atendente_painel(int) from public, anon;
grant execute on function public.ia_atendente_painel(int) to authenticated;


-- =====================================================================
-- 11. A fila: quem está esperando resposta da IA
-- =====================================================================
-- A cada 10 segundos (cron do seed da Imova). Uma conversa entra quando a IA
-- atende ali, a última mensagem da conversa é do cliente, ele parou de
-- escrever há `espera_seg` (para ler as três mensagens seguidas de uma vez) e
-- ninguém respondeu ainda. Pedido de corretor é resolvido aqui mesmo, sem
-- modelo. Freio do orçamento: em vez de silêncio, a conversa vai para gente.
create or replace function app.ia_atendente_enfileirar(p_limite int default 20)
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_cfg    jsonb := app.ia_atendente_config();
  v_espera interval := make_interval(secs => greatest(coalesce((v_cfg ->> 'espera_seg')::int, 15), 5));
  v_freio  jsonb;
  v_n      int := 0;
  x        record;
  v_r      jsonb;
begin
  if not coalesce((v_cfg ->> 'ligada')::boolean, false) then
    return 0;
  end if;

  for x in
    select c.id as conversation_id, u.id as message_id, u.body, u.type
      from public.conversations c
      cross join lateral (
        select m.id, m.direction, m.body, m.type, m.created_at
          from public.messages m
         where m.conversation_id = c.id
           and m.type not in ('reaction'::app.msg_type, 'system'::app.msg_type)
         order by m.created_at desc, m.id desc
         limit 1) u
     where c.last_inbound_at > now() - interval '24 hours'
       and c.channel = 'whatsapp'::app.channel
       and c.bloqueada_em is null
       and u.direction = 'in'::app.msg_direction
       and u.created_at <= now() - v_espera
       and not exists (select 1 from public.ia_respostas r where r.em_resposta_a = u.id)
       and app.ia_atende(c.id)
     order by u.created_at
     limit greatest(coalesce(p_limite, 20), 1)
  loop
    -- Quer corretor: avisa e passa na hora.
    if x.type = 'text'::app.msg_type and app.ia_pediu_corretor(x.body) then
      v_r := public.ia_atendente_passar(x.conversation_id, x.message_id, null,
                                        'o cliente pediu para falar com um corretor', null, 'regra');
      v_n := v_n + 1;
      continue;
    end if;

    v_freio := app.ia_pode_gastar('draft_reply');
    if not coalesce((v_freio ->> 'pode')::boolean, false) then
      v_r := public.ia_atendente_passar(x.conversation_id, x.message_id, null,
                                        'o orçamento de IA do mês chegou ao limite', null, 'regra');
      v_n := v_n + 1;
      continue;
    end if;

    perform app.esteira_enfileirar('ai_jobs',
              jsonb_build_object('purpose', 'draft_reply',
                                 'conversation_id', x.conversation_id,
                                 'message_id', x.message_id),
              'draft_reply:atender:' || x.message_id::text);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
comment on function app.ia_atendente_enfileirar(int) is
  'A fila da IA que atende (Imova): conversas em que a IA atende, cuja última mensagem é do cliente, parado há espera_seg e ainda sem resposta. Pedido de corretor passa por regra; orçamento no limite passa para gente. Agendada pelo seed da Imova (bloco 12h).';
revoke all on function app.ia_atendente_enfileirar(int) from public, anon, authenticated;

  $ddl$;

  -- ===================================================================
  -- 12. A porteira: o ramo (2a), trocado na função que está no banco
  -- ===================================================================
  v_def := pg_get_functiondef('app.messages_guard()'::regprocedure);
  if position('app.ia_atendente_autoriza' in v_def) > 0 then
    raise notice 'A porteira já tem o ramo da IA que atende.';
    return;
  end if;
  v_vezes := (length(v_def) - length(replace(v_def, v_ancora, ''))) / length(v_ancora);
  if v_vezes <> 1 then
    raise exception 'A porteira (app.messages_guard) não tem o trecho do ADR-05 exatamente uma vez (achei %): nada foi trocado.', v_vezes;
  end if;
  execute replace(v_def, v_ancora, v_trecho);
  -- O comentário de antes fica; só ganha a frase do ramo novo.
  execute format('comment on function app.messages_guard() is %L',
                 coalesce(obj_description('app.messages_guard()'::regprocedure, 'pg_proc') || ' ', '')
                 || 'Desde 06/11/2026, na Imova, o ramo (2a) deixa sair bot_ai sem rascunho só com a prova de app.ia_atendente_autoriza (a IA que atende o cliente); o resto não mudou.');
end $atende$;

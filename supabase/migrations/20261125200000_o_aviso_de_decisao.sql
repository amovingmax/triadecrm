-- =====================================================================
-- O aviso de decisão: a IA pergunta aos admins e responde ela mesma (Imova, 25/11/2026)
--
-- Pedido do dono: "ao invés de passar a conversa para o corretor, a IA poderia
-- somente perguntar para os admins e os admins escolheriam a opção que a IA
-- deve responder" (o caso da Paula: "Achei caro. O proprietário aceita 4
-- milhões?"). "A ideia é deixar a IA conversando com os clientes e, quando
-- necessário algum tipo de decisão que cabe aos corretores, a IA pergunta, os
-- corretores respondem a IA e a IA retorna uma resposta ao cliente."
-- Decisões dele, no mesmo dia, sobre o protótipo aprovado ("Gostei do jeito que
-- ficou"): a IA nunca diz que vai levar o caso "à equipe" ("Vou verificar",
-- "Vou estudar esse caso", "Vou repassar ao diretor"); os botões da proposta são
-- Aceitar, Recusar, Negociar outro valor e Vou consultar o proprietário; na
-- pergunta, duas respostas sugeridas pela IA e Escrever outra resposta.
--
-- O CAMINHO:
--   1. O cliente faz uma proposta de valor ou pergunta o que só a Imova decide
--      (financiamento, FGTS, desconto, um fato que não está escrito). A IA
--      (`atendente-imova@v10`) responde "Vou verificar e te retorno" (ou
--      parecido), NÃO passa a conversa e devolve a decisão: proposta (o valor
--      que o cliente disse) ou pergunta (as palavras dele e até 3 respostas
--      sugeridas, já escritas para o cliente).
--   2. O worker grava: `public.ia_atendente_pedir_decisao`. Uma decisão aberta
--      por conversa: a nova substitui a anterior.
--   3. A rodada de 10 segundos dos avisos manda um push a cada admin ativo
--      (`app.avisos_push_varrer_decisoes`); o site mostra o cartão
--      (`components/decisoes`), em qualquer tela.
--   4. Um admin decide (`public.ia_decisao_decidir`); o primeiro vale.
--        * Proposta: aceitar (a resposta leva o link da reunião online), recusar,
--          negociar outro valor ou "vou consultar o proprietário" (o cliente é
--          avisado e o cartão continua aberto até a resposta final).
--        * Pergunta: uma das respostas sugeridas sai como está; "escrever outra
--          resposta" vai à IA, que só ajusta o tom (`responder_decisao` na fila
--          `ai_jobs`; o worker devolve por `public.ia_decisao_dizer`).
--
-- A MENSAGEM AO CLIENTE é da IA (`app.ia_atendente_dizer`: assinada "Imova",
-- com o registro em `ia_respostas`, pela porteira de sempre), e a IA continua
-- atendendo. Se a IA não atende mais ali (alguém assumiu a conversa), a
-- resposta sai em nome do admin que decidiu, como no pedido de visita. Se a
-- porteira recusar, a decisão vale e a resposta diz que a mensagem não saiu.
--
-- Na KOMUNE não faz nada.
--
-- COMO DESFAZER: voltar o worker (sem a v10, ninguém chama a porta); drop das
-- funções `public.ia_atendente_pedir_decisao`, `public.ia_decisoes_abertas`,
-- `public.ia_decisao_decidir`, `public.ia_decisao_entrada`,
-- `public.ia_decisao_dizer`, `app.ia_decisao_*`,
-- `app.avisos_push_varrer_decisoes` e da tabela `public.ia_decisoes`;
-- reaplicar `app.avisos_push_rodar`, `app.avisos_catalogo` e a restrição
-- `push_fila_tipo_check` como estavam em 20261124190000 (sem 'decisao_pedida').
-- =====================================================================

do $imova$
begin
  if (select i.empresa from app.identidade i) = 'komune' then
    raise notice 'O aviso de decisão é da Imova: nada muda no banco da KOMUNE.';
    return;
  end if;

  -- -------------------------------------------------------------------
  -- 1. As decisões
  -- -------------------------------------------------------------------
  execute $ddl$
create table if not exists public.ia_decisoes (
  id                   uuid primary key default gen_random_uuid(),
  conversation_id      uuid not null references public.conversations (id) on delete cascade,
  organization_id      uuid references public.organizations (id) on delete set null,
  -- proposta: o cliente disse um valor. pergunta: o que só a Imova responde.
  tipo                 text not null check (tipo in ('proposta', 'pergunta')),
  anuncio_id           uuid references public.anuncios (id) on delete set null,
  imovel_codigo        text check (imovel_codigo is null or char_length(imovel_codigo) between 1 and 60),
  valor_anunciado      bigint check (valor_anunciado is null or valor_anunciado > 0),
  valor_proposto       bigint check (valor_proposto is null or valor_proposto > 0),
  -- As palavras do cliente, para o admin ler.
  pergunta             text not null check (char_length(pergunta) between 1 and 300),
  -- O que a IA já respondeu ("Vou verificar e te retorno").
  resposta_da_ia       text check (resposta_da_ia is null or char_length(resposta_da_ia) <= 600),
  -- Na pergunta: [{ "rotulo": "...", "resposta": "..." }], até 3, já escritas para o cliente.
  sugestoes            jsonb not null default '[]'::jsonb check (jsonb_typeof(sugestoes) = 'array'),
  situacao             text not null default 'aberta'
                         check (situacao in ('aberta', 'consultando', 'respondida', 'substituida')),
  escolha              text check (escolha is null or escolha in
                         ('aceitar', 'recusar', 'contraproposta', 'sugestao', 'escrita')),
  valor_decidido       bigint check (valor_decidido is null or valor_decidido > 0),
  texto_decidido       text check (texto_decidido is null or char_length(texto_decidido) <= 600),
  consultando_por      uuid references public.profiles (id) on delete set null,
  consultando_em       timestamptz,
  mensagem_consulta_id uuid references public.messages (id) on delete set null,
  decidido_por         uuid references public.profiles (id) on delete set null,
  decidido_em          timestamptz,
  mensagem_id          uuid references public.messages (id) on delete set null,
  -- Quando a resposta não saiu (porteira), o porquê.
  motivo               text check (motivo is null or char_length(motivo) <= 300),
  em_resposta_a        uuid references public.messages (id) on delete set null,
  ai_run_id            bigint,
  prompt_version       text,
  criado_em            timestamptz not null default now()
);
create index if not exists ia_decisoes_abertas_idx on public.ia_decisoes (criado_em)
  where situacao in ('aberta', 'consultando');
create index if not exists ia_decisoes_conversa on public.ia_decisoes (conversation_id, criado_em desc);
-- Uma decisão aberta por conversa: a nova substitui a anterior.
create unique index if not exists ia_decisoes_uma_aberta
  on public.ia_decisoes (conversation_id) where situacao in ('aberta', 'consultando');

comment on table public.ia_decisoes is
  'O aviso de decisão (Imova, 25/11/2026): em vez de passar a conversa, a IA responde "vou verificar" e pergunta aos admins (proposta de valor ou pergunta que só a Imova responde). O primeiro admin que decide vale, e a IA responde ao cliente com a decisão. Gravado só pelas funções.';

alter table public.ia_decisoes enable row level security;
drop policy if exists ia_decisoes_select on public.ia_decisoes;
create policy ia_decisoes_select on public.ia_decisoes
  for select to authenticated using (app.is_admin());
revoke all on public.ia_decisoes from anon, authenticated, service_role;
grant select on public.ia_decisoes to authenticated, service_role;

drop trigger if exists audit_ia_decisoes on public.ia_decisoes;
create trigger audit_ia_decisoes after insert or update or delete on public.ia_decisoes
  for each row execute function app.audit();
  $ddl$;

  -- -------------------------------------------------------------------
  -- 2. Os textos que o cliente recebe
  -- -------------------------------------------------------------------
  -- O valor como se escreve no Brasil: R$ 4.000.000.
  execute $ddl$
create or replace function app.ia_decisao_reais(p_valor bigint) returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_valor is null then null
              else 'R$ ' || replace(to_char(p_valor, 'FM999,999,999,999,990'), ',', '.') end
$$;
revoke all on function app.ia_decisao_reais(bigint) from public, anon, authenticated;
  $ddl$;

  -- O primeiro nome do cliente, só quando parece nome de gente ("Paula").
  execute $ddl$
create or replace function app.ia_decisao_primeiro_nome(p_conversa uuid) returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when x ~ '^[[:alpha:]][[:alpha:]''-]{1,19}$' then upper(substr(x, 1, 1)) || lower(substr(x, 2)) end
    from (select split_part(btrim(coalesce(
                   (select coalesce(nullif(btrim(o.name), ''), nullif(btrim(c.peer_nome), ''))
                      from public.conversations c
                      left join public.organizations o on o.id = c.organization_id
                     where c.id = p_conversa), '')), ' ', 1) as x) s
$$;
revoke all on function app.ia_decisao_primeiro_nome(uuid) from public, anon, authenticated;
  $ddl$;

  -- Os textos da proposta. O imóvel vem como o cliente reconhece ("o terreno em
  -- Capim Macio", de `app.visita_pedido_imovel`). Escritos igual à prévia do site
  -- (`components/decisoes/decisoes-da-ia.ts`).
  execute $ddl$
create or replace function app.ia_decisao_texto(p_qual text, p_nome text, p_imovel text,
                                                p_proposto bigint, p_anunciado bigint, p_valor bigint)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_nome text := nullif(btrim(coalesce(p_nome, '')), '');
  v_prop text := coalesce(app.ia_decisao_reais(p_proposto), 'o valor proposto');
  v_pelo text := case when p_imovel like 'o %' then 'pelo ' || substr(p_imovel, 3)
                      when p_imovel like 'a %' then 'pela ' || substr(p_imovel, 3)
                      else 'pelo imóvel' end;
  v_suj  text := case when p_imovel ~ '^(o|a) ' then upper(substr(p_imovel, 1, 1)) || substr(p_imovel, 2)
                      else 'O imóvel' end;
begin
  return case p_qual
    when 'consultar' then
      coalesce(v_nome || ', sua', 'Sua') || ' proposta de ' || v_prop
      || ' já está com o proprietário. Assim que ele responder, te aviso por aqui.'
    when 'aceitar' then
      'Boa notícia' || coalesce(', ' || v_nome, '') || ': o proprietário aceitou sua proposta de '
      || v_prop || ' ' || v_pelo
      || '. Para seguirmos, é só escolher o melhor dia e horário para conversarmos pelo link abaixo.'
    when 'aceitar_sem_link' then
      'Boa notícia' || coalesce(', ' || v_nome, '') || ': o proprietário aceitou sua proposta de '
      || v_prop || ' ' || v_pelo || '. Vou te passar os próximos passos em seguida.'
    when 'recusar' then
      coalesce(v_nome || ', o', 'O') || ' proprietário não aceitou a proposta de ' || v_prop || '.'
      || case when p_anunciado is not null
              then ' ' || v_suj || ' segue por ' || app.ia_decisao_reais(p_anunciado) || '.' else '' end
      || ' Se quiser fazer outra proposta, é só me dizer.'
    when 'contraproposta' then
      coalesce(v_nome || ', o', 'O') || ' proprietário não chegou aos ' || v_prop || ', mas aceita '
      || coalesce(app.ia_decisao_reais(p_valor), 'outro valor') || ' ' || v_pelo
      || '. Se fizer sentido para você, é só me dizer.'
  end;
end $$;
comment on function app.ia_decisao_texto(text, text, text, bigint, bigint, bigint) is
  'Os textos que o cliente recebe quando um admin decide uma proposta (Imova, 25/11/2026): consultar, aceitar (com o link da reunião), aceitar_sem_link, recusar e contraproposta. A prévia do site escreve igual.';
revoke all on function app.ia_decisao_texto(text, text, text, bigint, bigint, bigint) from public, anon, authenticated;
  $ddl$;

  -- A fala da decisão: como a IA (que continua atendendo); se a IA não atende
  -- mais ali, em nome do admin que decidiu. Devolve ok, message_id e como saiu.
  execute $ddl$
create or replace function app.ia_decisao_falar(p_conversa uuid, p_texto text, p_admin uuid,
                                                p_detalhes jsonb, p_ai_run_id bigint default null,
                                                p_prompt_version text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_r   jsonb;
  v_msg uuid;
begin
  v_r := app.ia_atendente_dizer(p_conversa, null, p_texto, 'respondeu', coalesce(p_detalhes, '{}'::jsonb),
                                p_ai_run_id, coalesce(p_prompt_version, 'aviso-de-decisao'));
  if coalesce((v_r ->> 'ok')::boolean, false) then
    return v_r || jsonb_build_object('como', 'ia');
  end if;
  if v_r ->> 'motivo' = 'ia_nao_atende' and p_admin is not null then
    begin
      insert into public.messages (conversation_id, direction, type, status, body,
                                   author_kind, sent_by, origin)
      values (p_conversa, 'out'::app.msg_direction, 'text'::app.msg_type,
              'queued'::app.msg_status, p_texto, 'human', p_admin, 'crm')
      returning id into v_msg;
      return jsonb_build_object('ok', true, 'message_id', v_msg, 'como', 'admin');
    exception when others then
      return jsonb_build_object('ok', false, 'motivo', 'porteira', 'erro', left(sqlerrm, 300));
    end;
  end if;
  return v_r;
end $$;
revoke all on function app.ia_decisao_falar(uuid, text, uuid, jsonb, bigint, text) from public, anon, authenticated;
  $ddl$;

  -- -------------------------------------------------------------------
  -- 3. A porta da IA
  -- -------------------------------------------------------------------
  execute $ddl$
create or replace function public.ia_atendente_pedir_decisao(
  p_conversation_id uuid, p_em_resposta_a uuid, p_tipo text, p_pergunta text,
  p_imovel_codigo text default null, p_valor_proposto bigint default null,
  p_sugestoes jsonb default '[]'::jsonb, p_resposta_da_ia text default null,
  p_ai_run_id bigint default null, p_prompt_version text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  c          public.conversations%rowtype;
  v_anuncio  uuid := case when nullif(btrim(coalesce(p_imovel_codigo, '')), '') is not null
                          then app.agenda_anuncio_do_codigo(p_imovel_codigo) end;
  v_codigo   text;
  v_preco    bigint;
  v_tipo     text := case when p_tipo in ('proposta', 'pergunta') then p_tipo end;
  v_pergunta text := left(nullif(btrim(regexp_replace(coalesce(p_pergunta, ''), '\s+', ' ', 'g')), ''), 300);
  v_resposta text := left(nullif(btrim(coalesce(p_resposta_da_ia, '')), ''), 600);
  v_sug      jsonb;
  v_id       uuid;
begin
  select * into c from public.conversations where id = p_conversation_id;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'conversa_nao_existe');
  end if;
  if v_tipo is null then
    return jsonb_build_object('ok', false, 'motivo', 'tipo_invalido');
  end if;
  if v_pergunta is null then
    return jsonb_build_object('ok', false, 'motivo', 'sem_pergunta');
  end if;
  -- Proposta sem valor não tem o que aceitar: vira pergunta.
  if v_tipo = 'proposta' and coalesce(p_valor_proposto, 0) <= 0 then
    v_tipo := 'pergunta';
  end if;
  if v_anuncio is not null then
    select a.codigo, a.preco_venda into v_codigo, v_preco from public.anuncios a where a.id = v_anuncio;
  end if;

  -- As sugestões (só na pergunta): até 3, com rótulo e resposta, sem repetir.
  select coalesce(jsonb_agg(jsonb_build_object('rotulo', s.rotulo, 'resposta', s.resposta) order by s.n), '[]'::jsonb)
    into v_sug
    from (select u.n, u.rotulo, u.resposta
            from (select distinct on (lower(r.resposta)) r.n, r.rotulo, r.resposta
                    from (select e.n,
                                 left(nullif(btrim(e.v ->> 'rotulo'), ''), 80) as rotulo,
                                 left(nullif(btrim(e.v ->> 'resposta'), ''), 300) as resposta
                            from jsonb_array_elements(case when jsonb_typeof(p_sugestoes) = 'array'
                                                           then p_sugestoes else '[]'::jsonb end)
                                 with ordinality as e (v, n)) r
                   where v_tipo = 'pergunta' and r.rotulo is not null and r.resposta is not null
                   order by lower(r.resposta), r.n) u
           order by u.n
           limit 3) s;

  update public.ia_decisoes
     set situacao = 'substituida', decidido_em = now()
   where conversation_id = p_conversation_id and situacao in ('aberta', 'consultando');

  insert into public.ia_decisoes (conversation_id, organization_id, tipo, anuncio_id, imovel_codigo,
                                  valor_anunciado, valor_proposto, pergunta, resposta_da_ia, sugestoes,
                                  em_resposta_a, ai_run_id, prompt_version)
  values (p_conversation_id, c.organization_id, v_tipo, v_anuncio,
          coalesce(v_codigo, left(nullif(btrim(coalesce(p_imovel_codigo, '')), ''), 60)),
          v_preco, case when v_tipo = 'proposta' then p_valor_proposto end,
          v_pergunta, v_resposta, v_sug, p_em_resposta_a, p_ai_run_id, left(p_prompt_version, 60))
  returning id into v_id;

  return jsonb_build_object('ok', true, 'decisao_id', v_id, 'tipo', v_tipo, 'anuncio_id', v_anuncio,
                            'sugestoes', jsonb_array_length(v_sug));
end $$;
comment on function public.ia_atendente_pedir_decisao(uuid, uuid, text, text, text, bigint, jsonb, text, bigint, text) is
  'Porta do worker de IA (Imova, 25/11/2026): grava a decisão que a IA pede aos admins em vez de passar a conversa: proposta (o valor que o cliente disse) ou pergunta (as palavras dele e até 3 respostas sugeridas). Uma aberta por conversa: a nova substitui a anterior. Proposta sem valor vira pergunta.';
revoke all on function public.ia_atendente_pedir_decisao(uuid, uuid, text, text, text, bigint, jsonb, text, bigint, text) from public, anon, authenticated;
grant execute on function public.ia_atendente_pedir_decisao(uuid, uuid, text, text, text, bigint, jsonb, text, bigint, text) to service_role;
  $ddl$;

  -- -------------------------------------------------------------------
  -- 4. A lista dos admins
  -- -------------------------------------------------------------------
  execute $ddl$
create or replace function public.ia_decisoes_abertas()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not app.is_admin() then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', d.id,
             'conversa_id', d.conversation_id,
             'cliente', app.nome_da_conversa(d.conversation_id),
             'primeiro_nome', app.ia_decisao_primeiro_nome(d.conversation_id),
             'caminho', app.caminho_da_conversa(d.conversation_id),
             'tipo', d.tipo,
             'situacao', d.situacao,
             'pergunta', d.pergunta,
             'resposta_da_ia', d.resposta_da_ia,
             'sugestoes', d.sugestoes,
             'imovel_codigo', d.imovel_codigo,
             'imovel', app.visita_pedido_imovel(d.anuncio_id),
             'titulo', app.visita_pedido_titulo(d.anuncio_id),
             'area', (select a.area_total from public.anuncios a where a.id = d.anuncio_id),
             'valor_anunciado', d.valor_anunciado,
             'valor_proposto', d.valor_proposto,
             'consultando_por', (select t.full_name from public.team_directory t where t.id = d.consultando_por),
             'consultando_em', d.consultando_em,
             'criado_em', d.criado_em) order by d.criado_em)
      from public.ia_decisoes d
     where d.situacao in ('aberta', 'consultando')), '[]'::jsonb);
end $$;
comment on function public.ia_decisoes_abertas() is
  'As decisões que a IA pediu e esperam um admin (Imova, 25/11/2026), da mais antiga à mais nova, abertas ou consultando o proprietário. Só admin; para os outros, lista vazia.';
revoke all on function public.ia_decisoes_abertas() from public, anon;
grant execute on function public.ia_decisoes_abertas() to authenticated;
  $ddl$;

  -- -------------------------------------------------------------------
  -- 5. A decisão
  -- -------------------------------------------------------------------
  execute $ddl$
create or replace function public.ia_decisao_decidir(
  p_id uuid, p_escolha text, p_valor bigint default null, p_texto text default null,
  p_sugestao integer default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  d        public.ia_decisoes%rowtype;
  v_eu     uuid := auth.uid();
  v_nome   text;
  v_imovel text;
  v_texto  text;
  v_r      jsonb := null;
  v_msg    uuid;
  v_saiu   boolean := false;
  v_como   text;
  v_erro   text;
  v_link   text;
  v_det    jsonb;
begin
  if v_eu is null or not app.is_admin() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  select * into d from public.ia_decisoes where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'nao_existe');
  end if;
  -- Qualquer admin decide; o primeiro vale.
  if d.situacao not in ('aberta', 'consultando') then
    return jsonb_build_object('ok', false, 'motivo', 'ja_decidido', 'situacao', d.situacao,
                              'por', (select t.full_name from public.team_directory t where t.id = d.decidido_por));
  end if;
  if (d.tipo = 'proposta' and p_escolha not in ('aceitar', 'recusar', 'contraproposta', 'consultar'))
     or (d.tipo = 'pergunta' and p_escolha not in ('sugestao', 'escrita'))
     or p_escolha is null then
    return jsonb_build_object('ok', false, 'motivo', 'escolha_invalida');
  end if;
  if p_escolha = 'consultar' and d.situacao = 'consultando' then
    return jsonb_build_object('ok', false, 'motivo', 'ja_consultando');
  end if;
  if p_escolha = 'contraproposta' and coalesce(p_valor, 0) <= 0 then
    return jsonb_build_object('ok', false, 'motivo', 'valor_invalido');
  end if;
  if p_escolha = 'sugestao' then
    v_texto := d.sugestoes -> coalesce(p_sugestao, -1) ->> 'resposta';
    if nullif(btrim(coalesce(v_texto, '')), '') is null then
      return jsonb_build_object('ok', false, 'motivo', 'sugestao_invalida');
    end if;
  end if;
  if p_escolha = 'escrita' then
    v_texto := left(nullif(btrim(regexp_replace(coalesce(p_texto, ''), '[ \t]+', ' ', 'g')), ''), 600);
    if v_texto is null then
      return jsonb_build_object('ok', false, 'motivo', 'texto_vazio');
    end if;
    -- A IA só ajusta o tom: o worker escreve e devolve por `public.ia_decisao_dizer`.
    update public.ia_decisoes
       set situacao = 'respondida', escolha = 'escrita', texto_decidido = v_texto,
           decidido_por = v_eu, decidido_em = now()
     where id = d.id;
    perform app.esteira_enfileirar(
      'ai_jobs',
      jsonb_build_object('purpose', 'responder_decisao', 'chave', 'responder_decisao:' || d.id,
                         'decisao_id', d.id, 'conversation_id', d.conversation_id),
      'responder_decisao:' || d.id);
    return jsonb_build_object('ok', true, 'escolha', 'escrita', 'ia_escreve', true);
  end if;

  v_nome := app.ia_decisao_primeiro_nome(d.conversation_id);
  v_imovel := app.visita_pedido_imovel(d.anuncio_id);
  v_det := jsonb_build_object('decisao', d.id, 'escolha', p_escolha, 'decidido_por', v_eu);

  -- Aceitar: a resposta leva o link da reunião online (o mesmo da IA, nota 5 b do
  -- caderno). Sem o link (agenda não configurada, IA fora da conversa), o aceite vai
  -- sem ele.
  if p_escolha = 'aceitar' then
    v_texto := app.ia_decisao_texto('aceitar', v_nome, v_imovel, d.valor_proposto, d.valor_anunciado, null);
    begin
      v_r := public.ia_atendente_enviar_link(d.conversation_id, null, 'reuniao', null, v_texto,
                                             null, 'aviso-de-decisao');
    exception when others then
      v_r := jsonb_build_object('ok', false, 'motivo', left(sqlerrm, 200));
    end;
    if coalesce((v_r ->> 'ok')::boolean, false) then
      v_saiu := true;
      v_como := 'ia';
      v_msg := (v_r ->> 'mensagem_id')::uuid;
      v_link := v_r ->> 'link';
    else
      v_texto := app.ia_decisao_texto('aceitar_sem_link', v_nome, v_imovel, d.valor_proposto, d.valor_anunciado, null);
      v_r := null;
    end if;
  elsif p_escolha <> 'sugestao' then
    v_texto := app.ia_decisao_texto(p_escolha, v_nome, v_imovel, d.valor_proposto, d.valor_anunciado, p_valor);
  end if;

  if not v_saiu then
    v_r := app.ia_decisao_falar(d.conversation_id, v_texto, v_eu, v_det);
    v_saiu := coalesce((v_r ->> 'ok')::boolean, false);
    v_como := v_r ->> 'como';
    v_msg := case when v_saiu then (v_r ->> 'message_id')::uuid end;
    if not v_saiu then
      v_erro := coalesce(v_r ->> 'erro', v_r ->> 'motivo', 'recusada');
    end if;
  end if;

  if p_escolha = 'consultar' then
    update public.ia_decisoes
       set situacao = 'consultando', consultando_por = v_eu, consultando_em = now(),
           mensagem_consulta_id = v_msg,
           motivo = case when not v_saiu then left('aviso ao cliente não saiu: ' || v_erro, 300) end
     where id = d.id;
  else
    update public.ia_decisoes
       set situacao = 'respondida', escolha = p_escolha,
           valor_decidido = case when p_escolha = 'contraproposta' then p_valor end,
           texto_decidido = case when p_escolha = 'sugestao' then v_texto end,
           decidido_por = v_eu, decidido_em = now(), mensagem_id = v_msg,
           motivo = case when not v_saiu then left('mensagem não saiu: ' || v_erro, 300) end
     where id = d.id;
  end if;

  return jsonb_build_object(
    'ok', true, 'escolha', p_escolha,
    'mensagem_saiu', v_saiu, 'como', v_como,
    'mensagem', case when v_link is not null then v_texto || E'\n\n' || v_link else v_texto end,
    'erro_da_mensagem', v_erro);
end $$;
comment on function public.ia_decisao_decidir(uuid, text, bigint, text, integer) is
  'A decisão de um admin sobre o que a IA perguntou (Imova, 25/11/2026). Proposta: aceitar (com o link da reunião), recusar, contraproposta (p_valor) ou consultar (o cliente é avisado e a decisão continua aberta). Pergunta: sugestao (p_sugestao, a posição começando em 0) ou escrita (p_texto; a IA ajusta o tom pelo worker). O primeiro admin que decide vale. A mensagem sai como da IA; com a IA fora da conversa, em nome de quem decidiu.';
revoke all on function public.ia_decisao_decidir(uuid, text, bigint, text, integer) from public, anon;
grant execute on function public.ia_decisao_decidir(uuid, text, bigint, text, integer) to authenticated;
  $ddl$;

  -- -------------------------------------------------------------------
  -- 6. "Escrever outra resposta": o que o worker lê e por onde devolve
  -- -------------------------------------------------------------------
  execute $ddl$
create or replace function public.ia_decisao_entrada(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select jsonb_build_object(
             'existe', true,
             'conversation_id', d.conversation_id,
             'organization_id', d.organization_id,
             'contact_id', c.contact_id,
             'nome', c.peer_nome,
             'escolha', d.escolha,
             'ja_respondida', d.mensagem_id is not null,
             'pergunta', d.pergunta,
             'resposta_da_ia', d.resposta_da_ia,
             'texto_decidido', d.texto_decidido,
             'imovel', app.visita_pedido_imovel(d.anuncio_id))
      from public.ia_decisoes d
      join public.conversations c on c.id = d.conversation_id
     where d.id = p_id), jsonb_build_object('existe', false))
$$;
comment on function public.ia_decisao_entrada(uuid) is
  'Porta do worker de IA (Imova, 25/11/2026): o que a IA lê para escrever a resposta que um admin escreveu no aviso de decisão (a pergunta do cliente, o que a IA tinha dito e o texto do admin).';
revoke all on function public.ia_decisao_entrada(uuid) from public, anon, authenticated;
grant execute on function public.ia_decisao_entrada(uuid) to service_role;
  $ddl$;

  execute $ddl$
create or replace function public.ia_decisao_dizer(p_id uuid, p_texto text,
                                                   p_ai_run_id bigint default null,
                                                   p_prompt_version text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  d       public.ia_decisoes%rowtype;
  v_texto text := left(nullif(btrim(coalesce(p_texto, '')), ''), 600);
  v_r     jsonb;
  v_saiu  boolean;
begin
  select * into d from public.ia_decisoes where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'nao_existe');
  end if;
  if d.situacao <> 'respondida' or d.escolha is distinct from 'escrita' then
    return jsonb_build_object('ok', false, 'motivo', 'nao_e_resposta_escrita');
  end if;
  if d.mensagem_id is not null then
    return jsonb_build_object('ok', false, 'motivo', 'ja_respondida');
  end if;
  -- Sem o texto da IA (o modelo falhou ou a rede de segurança segurou), vai o que o
  -- admin escreveu, com a primeira letra maiúscula e o ponto final: foi ele quem decidiu.
  if v_texto is null then
    v_texto := upper(substr(btrim(d.texto_decidido), 1, 1)) || substr(btrim(d.texto_decidido), 2);
    if v_texto !~ '[.!?…]$' then
      v_texto := v_texto || '.';
    end if;
  end if;
  v_r := app.ia_decisao_falar(d.conversation_id, v_texto, d.decidido_por,
                              jsonb_build_object('decisao', d.id, 'escolha', 'escrita',
                                                 'reescrita', p_texto is not null),
                              p_ai_run_id, p_prompt_version);
  v_saiu := coalesce((v_r ->> 'ok')::boolean, false);
  update public.ia_decisoes
     set mensagem_id = case when v_saiu then (v_r ->> 'message_id')::uuid end,
         texto_decidido = d.texto_decidido,
         motivo = case when not v_saiu
                       then left('mensagem não saiu: ' || coalesce(v_r ->> 'erro', v_r ->> 'motivo', 'recusada'), 300) end
   where id = d.id;
  return jsonb_build_object('ok', v_saiu, 'mensagem', v_texto, 'como', v_r ->> 'como',
                            'motivo', case when not v_saiu then coalesce(v_r ->> 'motivo', 'recusada') end);
end $$;
comment on function public.ia_decisao_dizer(uuid, text, bigint, text) is
  'Porta do worker de IA (Imova, 25/11/2026): manda ao cliente a resposta que um admin escreveu no aviso de decisão, com o tom ajustado pela IA; sem o texto da IA, vai o do admin. Uma vez por decisão.';
revoke all on function public.ia_decisao_dizer(uuid, text, bigint, text) from public, anon, authenticated;
grant execute on function public.ia_decisao_dizer(uuid, text, bigint, text) to service_role;
  $ddl$;

  -- -------------------------------------------------------------------
  -- 7. O aviso no celular, para cada admin ativo
  -- -------------------------------------------------------------------
  execute $ddl$
alter table app.push_fila drop constraint if exists push_fila_tipo_check;
alter table app.push_fila add constraint push_fila_tipo_check check (tipo = any (array[
  'mensagem', 'transferencia', 'compromisso', 'lembrete', 'atrasada', 'resumo', 'lote',
  'reuniao_robo', 'publicado', 'ligando', 'ligacao_perdida', 'lead_portal', 'espera',
  'espera_gestao', 'visita_pedida', 'decisao_pedida']));
  $ddl$;

  execute $ddl$
create or replace function app.avisos_catalogo()
returns table (tipo text, nome text, descricao text, ordem integer)
language sql
stable
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
      ('lead_portal',     'Lead novo dos portais',      'Quando alguém escreve num anúncio do ZAP, do Viva Real ou da OLX.', 12, 'imova'),
      ('espera',          'Cliente esperando resposta', 'Quando um cliente espera a nossa resposta há 15 minutos de trabalho. Antes da primeira resposta, todos que atendem são avisados; depois, quem atende a conversa.', 13, 'imova'),
      ('espera_gestao',   'Cliente esperando há 1 hora', 'Para admin e gestor: quando um cliente espera a nossa resposta há 1 hora de trabalho, com o nome de quem atende.', 14, 'imova'),
      ('visita_pedida',   'Pedido de visita',           'Para admin: quando a IA combina uma visita presencial com um cliente e ela espera a sua aprovação.', 15, 'imova'),
      ('decisao_pedida',  'Decisão para a IA',          'Para admin: quando um cliente faz uma proposta ou pergunta o que só a Imova decide, e a IA espera a sua resposta para responder a ele.', 16, 'imova')
    ) as v (tipo, nome, descricao, ordem, empresa)
   where v.empresa is null or v.empresa = (select i.empresa from app.identidade i limit 1);
$$;
revoke all on function app.avisos_catalogo() from public, anon, authenticated;
  $ddl$;

  execute $ddl$
create or replace function app.avisos_push_varrer_decisoes()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  insert into app.push_fila (pessoa_id, tipo, chave, corpo, caminho, conversa_id)
  select t.id, 'decisao_pedida', 'decisao_pedida:' || d.id || ':' || t.id,
         left(case when d.tipo = 'proposta'
                   then 'Proposta: ' || coalesce(app.nome_da_conversa(d.conversation_id), 'um cliente')
                        || ' oferece ' || app.ia_decisao_reais(d.valor_proposto)
                        || coalesce(' por ' || regexp_replace(app.visita_pedido_imovel(d.anuncio_id), '^(o|a) ', ''), '')
                        || coalesce(' (anunciado por ' || app.ia_decisao_reais(d.valor_anunciado) || ')', '')
                   else 'Pergunta de ' || coalesce(app.nome_da_conversa(d.conversation_id), 'um cliente')
                        || ': “' || d.pergunta || '”' end,
              240),
         app.caminho_da_conversa(d.conversation_id),
         d.conversation_id
    from public.ia_decisoes d
   cross join public.team_directory t
   where d.situacao = 'aberta'
     and d.criado_em > now() - interval '2 minutes'
     and t.is_active and t.role = 'admin'
  on conflict (chave) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
comment on function app.avisos_push_varrer_decisoes() is
  'Rodada dos avisos (Imova, 25/11/2026): um aviso "Proposta" ou "Pergunta" para cada admin ativo, por decisão que a IA pediu nos últimos 2 minutos. O toque abre a conversa.';
revoke all on function app.avisos_push_varrer_decisoes() from public, anon, authenticated;
  $ddl$;

  execute $ddl$
create or replace function app.avisos_push_rodar()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_novos    integer := 0;
  v_enviados integer := 0;
  v_apagados integer := 0;
  v_leads    integer := 0;
  v_espera   integer := 0;
  v_visitas  integer := 0;
  v_decisoes integer := 0;
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
  -- 11/11/2026: a espera em degraus (15 min para quem atende, 1 h para a gestão).
  if app.avisos_empresa() = 'imova'
     and to_regprocedure('app.avisos_push_varrer_espera(timestamptz)') is not null then
    begin
      execute 'select app.avisos_push_varrer_espera(now())' into v_espera;
      v_novos := v_novos + coalesce(v_espera, 0);
    exception when others then raise warning 'avisos_push_varrer_espera: %', sqlerrm; end;
  end if;
  -- 24/11/2026: o pedido de visita que a IA combinou, para todos os admins.
  if app.avisos_empresa() = 'imova'
     and to_regprocedure('app.avisos_push_varrer_visitas()') is not null then
    begin
      execute 'select app.avisos_push_varrer_visitas()' into v_visitas;
      v_novos := v_novos + coalesce(v_visitas, 0);
    exception when others then raise warning 'avisos_push_varrer_visitas: %', sqlerrm; end;
  end if;
  -- 25/11/2026: a decisão que a IA pede aos admins (proposta ou pergunta).
  if app.avisos_empresa() = 'imova'
     and to_regprocedure('app.avisos_push_varrer_decisoes()') is not null then
    begin
      execute 'select app.avisos_push_varrer_decisoes()' into v_decisoes;
      v_novos := v_novos + coalesce(v_decisoes, 0);
    exception when others then raise warning 'avisos_push_varrer_decisoes: %', sqlerrm; end;
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
  'A rodada dos avisos no celular, a cada 10 segundos pelo pg_cron: confere as respostas do Expo, varre o que aconteceu (e, na Imova, os leads novos dos portais, a espera em degraus, os pedidos de visita e as decisões que a IA pede) e manda o que estiver na fila.';
  $ddl$;
end
$imova$;

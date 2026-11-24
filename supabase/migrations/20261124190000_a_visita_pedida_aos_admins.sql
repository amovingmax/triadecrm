-- =====================================================================
-- A visita presencial vira um pedido que os admins aprovam (Imova, 24/11/2026)
--
-- Pedido do dono: "A visita presencial não deve ser apresentada como link ou
-- como algo certo. Deve ser enviado uma solicitação se dá certo e deve
-- aparecer um aviso para todos os admins." Decisões dele (por pergunta, no
-- mesmo dia): o aviso aparece no CRM e no celular; qualquer admin aprova (o
-- primeiro que decide vale, e o pedido some para os outros). É o item 15 da
-- entrevista de 24/11 ("IA combina, admin aprova, IA confirma").
--
-- O CAMINHO:
--   1. O cliente diz o dia (e o período) da visita. A IA (`atendente-imova@v9`)
--      responde a frase da nota 9 (e) do caderno ("Vou consultar um horário em
--      que entre na minha agenda e te retorno pra combinarmos."), passa a
--      conversa e devolve o pedido (imóvel, data, período, como ele disse).
--   2. O worker grava o pedido: `public.ia_atendente_pedir_visita`.
--   3. A rodada de 10 segundos dos avisos manda um push "Pedido de visita" a
--      cada admin ativo (`app.avisos_push_varrer_visitas`); o site mostra o
--      cartão com Aprovar, Outro dia e Recusar (`components/visitas`).
--   4. Um admin decide: `public.visita_pedido_decidir`.
--        * Aprovar (com dia e hora): a visita entra na Agenda com o imóvel
--          (`public.visita_marcar_com_imovel`, dono = quem aprovou) e o cliente
--          recebe "Combinado! Sua visita ... ficou para ...".
--        * Outro dia (com dia e hora): o cliente recebe a proposta; a resposta
--          dele chega à equipe como qualquer mensagem.
--        * Recusar: nada sai; o admin fala com o cliente pela conversa.
--
-- A MENSAGEM AO CLIENTE sai como mensagem de quem decidiu (author_kind human,
-- assinada com o primeiro nome pelo gatilho de sempre), pela porteira de
-- sempre. Não sai como mensagem da IA: depois de passar a conversa a IA não
-- atende ali, e a porteira só deixa sair `bot_ai` onde ela atende. Se a
-- porteira recusar (janela de 24 h fechada, contato suprimido), a decisão vale
-- e a resposta diz que a mensagem não saiu, para o admin falar com o cliente.
--
-- Na KOMUNE não faz nada.
--
-- COMO DESFAZER: drop das funções `public.ia_atendente_pedir_visita`,
-- `public.visita_pedidos_abertos`, `public.visita_pedido_decidir`,
-- `app.visita_pedido_texto`, `app.avisos_push_varrer_visitas` e da tabela
-- `public.visita_pedidos`; reaplicar `app.avisos_push_rodar`,
-- `app.avisos_catalogo` e a restrição `push_fila_tipo_check` como estavam (sem
-- 'visita_pedida'). O worker não chama a porta se ela não existir.
-- =====================================================================

do $imova$
begin
  if (select i.empresa from app.identidade i) = 'komune' then
    raise notice 'O pedido de visita é da Imova: nada muda no banco da KOMUNE.';
    return;
  end if;

  -- -------------------------------------------------------------------
  -- 1. Os pedidos
  -- -------------------------------------------------------------------
  execute $ddl$
create table if not exists public.visita_pedidos (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.conversations (id) on delete cascade,
  organization_id  uuid references public.organizations (id) on delete set null,
  anuncio_id       uuid references public.anuncios (id) on delete set null,
  imovel_codigo    text check (imovel_codigo is null or char_length(imovel_codigo) between 1 and 60),
  -- O dia como a IA entendeu (nulo quando ela não soube contar) e o período.
  data             date,
  periodo          text check (periodo is null or periodo in ('manha', 'tarde', 'noite')),
  -- As palavras do cliente sobre o dia ("quinta de manhã"), para o admin conferir.
  como_disse       text check (como_disse is null or char_length(como_disse) between 1 and 120),
  situacao         text not null default 'pendente'
                     check (situacao in ('pendente', 'aprovada', 'outro_dia', 'recusada', 'substituida')),
  -- Aprovada: o dia e a hora da visita. Outro dia: o dia e a hora propostos.
  marcada_para     timestamptz,
  motivo           text check (motivo is null or char_length(motivo) <= 300),
  decidido_por     uuid references public.profiles (id) on delete set null,
  decidido_em      timestamptz,
  task_id          uuid references public.tasks (id) on delete set null,
  mensagem_id      uuid references public.messages (id) on delete set null,
  em_resposta_a    uuid references public.messages (id) on delete set null,
  ai_run_id        bigint,
  prompt_version   text,
  criado_em        timestamptz not null default now()
);
create index if not exists visita_pedidos_pendentes on public.visita_pedidos (criado_em)
  where situacao = 'pendente';
create index if not exists visita_pedidos_conversa on public.visita_pedidos (conversation_id, criado_em desc);
-- Um pedido aberto por conversa: o novo substitui o anterior.
create unique index if not exists visita_pedidos_um_aberto
  on public.visita_pedidos (conversation_id) where situacao = 'pendente';

comment on table public.visita_pedidos is
  'Pedidos de visita presencial que a IA combinou com o cliente (Imova, 24/11/2026). Todos os admins são avisados (CRM e celular) e qualquer um decide: aprovar (vira visita na Agenda e o cliente recebe a confirmação), outro dia (o cliente recebe a proposta) ou recusar. Gravado só pelas funções.';

alter table public.visita_pedidos enable row level security;
drop policy if exists visita_pedidos_select on public.visita_pedidos;
create policy visita_pedidos_select on public.visita_pedidos
  for select to authenticated using (app.is_admin());
revoke all on public.visita_pedidos from anon, authenticated, service_role;
grant select on public.visita_pedidos to authenticated, service_role;

drop trigger if exists audit_visita_pedidos on public.visita_pedidos;
create trigger audit_visita_pedidos after insert or update or delete on public.visita_pedidos
  for each row execute function app.audit();
  $ddl$;

  -- -------------------------------------------------------------------
  -- 2. Os textos (o que o admin lê e o que o cliente recebe)
  -- -------------------------------------------------------------------
  execute $ddl$
create or replace function app.visita_pedido_texto(p_qual text, p_quando timestamptz,
                                                  p_data date, p_periodo text, p_imovel text)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_dias   text[] := array['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira',
                           'quinta-feira', 'sexta-feira', 'sábado'];
  v_local  timestamp := p_quando at time zone 'America/Fortaleza';
  v_dia    text;
  v_hora   text;
  v_pedido text;
begin
  if p_quando is not null then
    v_dia := v_dias[extract(dow from v_local)::int + 1] || ', ' || to_char(v_local, 'DD/MM');
    v_hora := case when extract(minute from v_local) = 0 then to_char(v_local, 'FMHH24') || 'h'
                   else to_char(v_local, 'FMHH24"h"MI') end;
  end if;
  if p_data is not null then
    v_pedido := v_dias[extract(dow from p_data)::int + 1] || ', ' || to_char(p_data, 'DD/MM')
                || case p_periodo when 'manha' then ', de manhã' when 'tarde' then ', à tarde'
                                  when 'noite' then ', à noite' else '' end;
  end if;
  return case p_qual
    -- O que vai ao cliente quando um admin aprova.
    when 'aprovada' then
      'Combinado! Sua visita '
      || case when p_imovel like 'o %' then 'ao ' || substr(p_imovel, 3)
              when p_imovel like 'a %' then 'à ' || substr(p_imovel, 3)
              else 'ao imóvel' end
      || ' ficou para ' || v_dia || ', às ' || v_hora
      || '. Qualquer coisa, é só me chamar por aqui.'
    -- O que vai ao cliente quando um admin propõe outro dia.
    when 'outro_dia' then
      'Nesse dia não vamos conseguir. Pode ser ' || v_dia || ', às ' || v_hora || '?'
    -- O dia que o cliente pediu, para o admin ler.
    when 'pedido' then coalesce(v_pedido, 'dia a combinar')
  end;
end $$;
comment on function app.visita_pedido_texto(text, timestamptz, date, text, text) is
  'Os textos do pedido de visita (Imova, 24/11/2026): a confirmação e a proposta de outro dia que vão ao cliente, e o dia pedido por extenso para o admin.';
revoke all on function app.visita_pedido_texto(text, timestamptz, date, text, text) from public, anon, authenticated;
  $ddl$;

  -- O imóvel como o cliente reconhece: "o terreno em Tabatinga" (sem código).
  execute $ddl$
create or replace function app.visita_pedido_imovel(p_anuncio uuid) returns text
language sql
stable
security definer
set search_path = ''
as $$
  select nullif(btrim(
           case a.tipo::text when 'terreno' then 'o terreno' when 'casa' then 'a casa'
                             when 'apartamento' then 'o apartamento' when 'sala_comercial' then 'a sala'
                             when 'loja' then 'a loja' else 'o imóvel' end
           || coalesce(' em ' || nullif(btrim(a.bairro), ''), '')), '')
    from public.anuncios a where a.id = p_anuncio
$$;
revoke all on function app.visita_pedido_imovel(uuid) from public, anon, authenticated;
  $ddl$;

  -- -------------------------------------------------------------------
  -- 3. A porta da IA
  -- -------------------------------------------------------------------
  execute $ddl$
create or replace function public.ia_atendente_pedir_visita(
  p_conversation_id uuid, p_em_resposta_a uuid, p_imovel_codigo text,
  p_data date default null, p_periodo text default null, p_como_disse text default null,
  p_ai_run_id bigint default null, p_prompt_version text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  c         public.conversations%rowtype;
  v_anuncio uuid := app.agenda_anuncio_do_codigo(p_imovel_codigo);
  v_codigo  text;
  v_hoje    date := (now() at time zone 'America/Fortaleza')::date;
  v_data    date := p_data;
  v_periodo text := case when p_periodo in ('manha', 'tarde', 'noite') then p_periodo end;
  v_disse   text := left(nullif(btrim(regexp_replace(coalesce(p_como_disse, ''), '\s+', ' ', 'g')), ''), 120);
  v_id      uuid;
begin
  select * into c from public.conversations where id = p_conversation_id;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'conversa_nao_existe');
  end if;
  if v_anuncio is not null then
    select a.codigo into v_codigo from public.anuncios a where a.id = v_anuncio;
  end if;
  -- Dia no passado ou longe demais: a IA contou errado; fica o que o cliente disse.
  if v_data is not null and (v_data < v_hoje or v_data > v_hoje + 60) then
    v_data := null;
  end if;

  update public.visita_pedidos
     set situacao = 'substituida', decidido_em = now()
   where conversation_id = p_conversation_id and situacao = 'pendente';

  insert into public.visita_pedidos (conversation_id, organization_id, anuncio_id, imovel_codigo,
                                     data, periodo, como_disse, em_resposta_a, ai_run_id, prompt_version)
  values (p_conversation_id, c.organization_id, v_anuncio, coalesce(v_codigo, nullif(btrim(p_imovel_codigo), '')),
          v_data, v_periodo, v_disse, p_em_resposta_a, p_ai_run_id, left(p_prompt_version, 60))
  returning id into v_id;

  return jsonb_build_object('ok', true, 'pedido_id', v_id, 'anuncio_id', v_anuncio, 'data', v_data);
end $$;
comment on function public.ia_atendente_pedir_visita(uuid, uuid, text, date, text, text, bigint, text) is
  'Porta do worker de IA (Imova, 24/11/2026): grava o pedido de visita presencial que a IA combinou (imóvel, dia, período, como o cliente disse) para os admins aprovarem. Um pedido aberto por conversa: o novo substitui o anterior. Dia no passado ou a mais de 60 dias vira nulo.';
revoke all on function public.ia_atendente_pedir_visita(uuid, uuid, text, date, text, text, bigint, text) from public, anon, authenticated;
grant execute on function public.ia_atendente_pedir_visita(uuid, uuid, text, date, text, text, bigint, text) to service_role;
  $ddl$;

  -- -------------------------------------------------------------------
  -- 4. A lista dos admins
  -- -------------------------------------------------------------------
  execute $ddl$
create or replace function public.visita_pedidos_abertos()
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
             'id', p.id,
             'conversa_id', p.conversation_id,
             'cliente', app.nome_da_conversa(p.conversation_id),
             'caminho', app.caminho_da_conversa(p.conversation_id),
             'imovel_codigo', p.imovel_codigo,
             'imovel', coalesce(app.visita_pedido_imovel(p.anuncio_id), p.imovel_codigo, 'imóvel a confirmar'),
             'anuncio_id', p.anuncio_id,
             'data', p.data,
             'periodo', p.periodo,
             'dia_pedido', app.visita_pedido_texto('pedido', null, p.data, p.periodo, null),
             'como_disse', p.como_disse,
             'criado_em', p.criado_em) order by p.criado_em)
      from public.visita_pedidos p
     where p.situacao = 'pendente'), '[]'::jsonb);
end $$;
comment on function public.visita_pedidos_abertos() is
  'Os pedidos de visita esperando decisão (Imova, 24/11/2026), do mais antigo ao mais novo. Só admin; para os outros, lista vazia.';
revoke all on function public.visita_pedidos_abertos() from public, anon;
grant execute on function public.visita_pedidos_abertos() to authenticated;
  $ddl$;

  -- -------------------------------------------------------------------
  -- 5. A decisão
  -- -------------------------------------------------------------------
  execute $ddl$
create or replace function public.visita_pedido_decidir(
  p_id uuid, p_decisao text, p_quando timestamptz default null, p_motivo text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  p        public.visita_pedidos%rowtype;
  v_eu     uuid := auth.uid();
  v_texto  text;
  v_msg    uuid;
  v_saiu   boolean := false;
  v_erro   text;
  v_visita jsonb;
  v_task   uuid;
  v_motivo text := left(nullif(btrim(coalesce(p_motivo, '')), ''), 300);
begin
  if v_eu is null or not app.is_admin() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if p_decisao not in ('aprovada', 'outro_dia', 'recusada') then
    return jsonb_build_object('ok', false, 'motivo', 'decisao_invalida');
  end if;
  select * into p from public.visita_pedidos where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'nao_existe');
  end if;
  -- Qualquer admin decide; o primeiro vale.
  if p.situacao <> 'pendente' then
    return jsonb_build_object('ok', false, 'motivo', 'ja_decidido', 'situacao', p.situacao,
                              'por', (select t.full_name from public.team_directory t where t.id = p.decidido_por));
  end if;
  if p_decisao in ('aprovada', 'outro_dia') and (p_quando is null or p_quando < now()) then
    return jsonb_build_object('ok', false, 'motivo', 'quando_invalido');
  end if;

  -- A visita na Agenda, com o imóvel (quem aprovou é o dono).
  if p_decisao = 'aprovada' and p.organization_id is not null then
    v_visita := public.visita_marcar_com_imovel(p.organization_id, p_quando, null, v_eu, p.anuncio_id, null);
    if coalesce((v_visita ->> 'ok')::boolean, false) then
      v_task := (v_visita ->> 'task_id')::uuid;
    end if;
  end if;

  -- A mensagem ao cliente, pela porteira de sempre, em nome de quem decidiu.
  if p_decisao in ('aprovada', 'outro_dia') then
    v_texto := app.visita_pedido_texto(p_decisao, p_quando, p.data, p.periodo,
                                       app.visita_pedido_imovel(p.anuncio_id));
    begin
      insert into public.messages (conversation_id, direction, type, status, body,
                                   author_kind, sent_by, origin)
      values (p.conversation_id, 'out'::app.msg_direction, 'text'::app.msg_type,
              'queued'::app.msg_status, v_texto, 'human', v_eu, 'crm')
      returning id into v_msg;
      v_saiu := true;
    exception when others then
      v_erro := left(sqlerrm, 300);
    end;
  end if;

  update public.visita_pedidos
     set situacao = p_decisao,
         marcada_para = case when p_decisao in ('aprovada', 'outro_dia') then p_quando end,
         motivo = coalesce(v_motivo, case when not v_saiu and v_erro is not null then 'mensagem não saiu: ' || v_erro end),
         decidido_por = v_eu,
         decidido_em = now(),
         task_id = v_task,
         mensagem_id = v_msg
   where id = p.id;

  return jsonb_build_object(
    'ok', true, 'decisao', p_decisao,
    'mensagem_saiu', v_saiu, 'mensagem', v_texto, 'erro_da_mensagem', v_erro,
    'na_agenda', v_task is not null, 'task_id', v_task,
    'agenda', case when p_decisao = 'aprovada' and v_task is null then coalesce(v_visita, '{"motivo":"sem_ficha"}'::jsonb) end);
end $$;
comment on function public.visita_pedido_decidir(uuid, text, timestamptz, text) is
  'A decisão de um admin sobre um pedido de visita (Imova, 24/11/2026): aprovada (visita na Agenda com o imóvel e a confirmação ao cliente), outro_dia (a proposta ao cliente) ou recusada (nada sai). O primeiro admin que decide vale. A mensagem sai em nome de quem decidiu; se a porteira recusar, a decisão vale e a resposta diz que não saiu.';
revoke all on function public.visita_pedido_decidir(uuid, text, timestamptz, text) from public, anon;
grant execute on function public.visita_pedido_decidir(uuid, text, timestamptz, text) to authenticated;
  $ddl$;

  -- -------------------------------------------------------------------
  -- 6. O aviso no celular: "Pedido de visita", para cada admin ativo
  -- -------------------------------------------------------------------
  execute $ddl$
alter table app.push_fila drop constraint if exists push_fila_tipo_check;
alter table app.push_fila add constraint push_fila_tipo_check check (tipo = any (array[
  'mensagem', 'transferencia', 'compromisso', 'lembrete', 'atrasada', 'resumo', 'lote',
  'reuniao_robo', 'publicado', 'ligando', 'ligacao_perdida', 'lead_portal', 'espera',
  'espera_gestao', 'visita_pedida']));
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
      ('visita_pedida',   'Pedido de visita',           'Para admin: quando a IA combina uma visita presencial com um cliente e ela espera a sua aprovação.', 15, 'imova')
    ) as v (tipo, nome, descricao, ordem, empresa)
   where v.empresa is null or v.empresa = (select i.empresa from app.identidade i limit 1);
$$;
revoke all on function app.avisos_catalogo() from public, anon, authenticated;
  $ddl$;

  execute $ddl$
create or replace function app.avisos_push_varrer_visitas()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  insert into app.push_fila (pessoa_id, tipo, chave, corpo, caminho, conversa_id)
  select t.id, 'visita_pedida', 'visita_pedida:' || p.id || ':' || t.id,
         left('Pedido de visita: ' || coalesce(app.nome_da_conversa(p.conversation_id), 'um cliente')
              || ' quer ver ' || coalesce(app.visita_pedido_imovel(p.anuncio_id), 'um imóvel')
              || ' · ' || coalesce(nullif(p.como_disse, ''), app.visita_pedido_texto('pedido', null, p.data, p.periodo, null)),
              240),
         app.caminho_da_conversa(p.conversation_id),
         p.conversation_id
    from public.visita_pedidos p
   cross join public.team_directory t
   where p.situacao = 'pendente'
     and p.criado_em > now() - interval '2 minutes'
     and t.is_active and t.role = 'admin'
  on conflict (chave) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
comment on function app.avisos_push_varrer_visitas() is
  'Rodada dos avisos (Imova, 24/11/2026): um aviso "Pedido de visita" para cada admin ativo, por pedido aberto nos últimos 2 minutos. O toque abre a conversa.';
revoke all on function app.avisos_push_varrer_visitas() from public, anon, authenticated;
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
  begin v_enviados := app.avisos_push_enviar();
  exception when others then raise warning 'avisos_push_enviar: %', sqlerrm; end;
  -- A fila e os envios guardam uma semana: é registro de aviso, não histórico.
  delete from app.push_fila where criado_em < now() - interval '7 days';
  delete from app.push_envios where enviado_em < now() - interval '7 days';
  return jsonb_build_object('ligado', true, 'novos', v_novos, 'enviados', v_enviados,
                            'aparelhos_esquecidos', v_apagados);
end $$;
comment on function app.avisos_push_rodar() is
  'A rodada dos avisos no celular, a cada 10 segundos pelo pg_cron: confere as respostas do Expo, varre o que aconteceu (e, na Imova, os leads novos dos portais, a espera em degraus e os pedidos de visita) e manda o que estiver na fila.';
  $ddl$;
end
$imova$;

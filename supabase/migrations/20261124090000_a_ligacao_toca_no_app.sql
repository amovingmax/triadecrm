-- =============================================================================
-- A LIGAÇÃO TOCA NO APP (tela de chamada do iPhone) — 23 e 24/11/2026
-- =============================================================================
-- Pedido do usuário (23/11/2026): "o celular [precisa receber] ligações com o app
-- fechado [...] uma interface para aceitar ou rejeitar chamada, assim como a do
-- WhatsApp, e [...] um toque que seja audível".
--
-- Hoje a ligação pelo WhatsApp (migração 20261030120000) só toca com o CRM aberto, e o
-- celular recebe um aviso comum ("Fulano está ligando"). Com esta migração:
--
--   1. o app do iPhone registra, além do endereço de push do Expo, o ENDEREÇO DE
--      CHAMADA da Apple (PushKit, o aviso de voz): `aparelhos_push.voip_token`;
--   2. o cliente liga, a ligação entra em `wa_chamadas` tocando e um gatilho cutuca a
--      Edge Function `voip-push` (pg_net). Ela pergunta ao banco quem deve tocar
--      (`public.voip_a_enviar`) e manda o aviso de chamada direto à Apple. O iPhone
--      mostra a tela de chamada do sistema, com Atender e Recusar e o toque do
--      telefone, mesmo bloqueado e com o app fechado;
--   3. cada aparelho recebe um CONVITE de uso único para aquela ligação. Atender no
--      celular usa o convite na Edge Function `wa-chamada-app` (com o app fechado não
--      há página aberta nem sessão do site), que reserva a ligação com as mesmas
--      regras do botão Atender do navegador (`public.wa_chamada_app`);
--   4. quando a ligação sai de "tocando" (alguém atendeu, no celular ou no computador;
--      o cliente desistiu; ninguém atendeu), o mesmo gatilho manda "parar" aos
--      aparelhos que tocaram, menos o que atendeu.
--
-- O aparelho que tem o endereço de chamada deixa de receber o aviso comum "está
-- ligando": a tela de chamada já é o aviso. O "Ligação perdida" continua igual.
--
-- NADA MUDA NA KOMUNE: tudo depende de `app.wa_ligacao_ligada()`, que só liga no banco
-- da Imova, e da chave `ligacao.app`, que nasce desligada e sem o endereço da função.
-- Ligar é um passo à parte (docs/operacao/ligacao-whatsapp.md, "A ligação no app").
-- =============================================================================

create extension if not exists pg_net;

-- -----------------------------------------------------------------------------
-- 1. A chave
-- -----------------------------------------------------------------------------
insert into public.app_settings (key, value, description)
values ('ligacao.app', '{"ativa": false, "funcao_url": null}'::jsonb,
        'A ligação pelo WhatsApp tocando na tela de chamada do app do iPhone. funcao_url = https://<projeto>.supabase.co/functions/v1. Só vale com whatsapp.ligacao ligada (só na Imova).')
on conflict (key) do nothing;

create or replace function app.voip_ligado() returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select (s.value ->> 'ativa')::boolean
                     from public.app_settings s where s.key = 'ligacao.app'), false)
     and app.wa_ligacao_ligada();
$$;
comment on function app.voip_ligado() is
  'A ligação toca na tela de chamada do app? Chave ligacao.app e a ligação pelo WhatsApp ligada (só Imova).';
revoke all on function app.voip_ligado() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. O endereço de chamada do aparelho
-- -----------------------------------------------------------------------------
-- O endereço que a Apple dá ao app para o aviso de voz (PushKit), em hexadecimal. Só
-- iPhone. `voip_sandbox` marca o app montado para teste, que usa o servidor de teste da
-- Apple; o TestFlight e a App Store usam o de produção.
alter table public.aparelhos_push
  add column if not exists voip_token text
    check (voip_token is null or voip_token ~ '^[0-9a-f]{64,200}$'),
  add column if not exists voip_sandbox boolean not null default false;
create unique index if not exists aparelhos_push_voip
  on public.aparelhos_push (voip_token) where voip_token is not null;
comment on column public.aparelhos_push.voip_token is
  'Endereço de chamada da Apple (PushKit) deste aparelho: a ligação pelo WhatsApp toca na tela de chamada do iPhone. Gravado por public.aparelho_voip_registrar.';

-- O app entrega o endereço de chamada junto com o de push (`/api/aparelhos`). Só vale
-- para o aparelho que já é de quem está logado.
create or replace function public.aparelho_voip_registrar(
  p_token text, p_voip text, p_sandbox boolean default false
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'sem sessão' using errcode = '42501';
  end if;
  if p_voip is null or p_voip !~ '^[0-9a-f]{64,200}$' then
    raise exception 'endereço de chamada inválido' using errcode = '22023';
  end if;
  -- O mesmo iPhone com o app reinstalado ganha outro endereço do Expo e pode manter o
  -- da Apple: o endereço de chamada fica só na linha nova.
  update public.aparelhos_push set voip_token = null
   where voip_token = p_voip and token <> p_token;
  update public.aparelhos_push
     set voip_token = p_voip, voip_sandbox = coalesce(p_sandbox, false), visto_em = now()
   where token = p_token and pessoa_id = auth.uid() and plataforma = 'ios';
  return found;
end $$;
comment on function public.aparelho_voip_registrar(text, text, boolean) is
  'O app do iPhone entrega o endereço de chamada (PushKit) do aparelho de quem está logado. Chamada pelo site (/api/aparelhos) depois de public.aparelho_registrar.';
revoke all on function public.aparelho_voip_registrar(text, text, boolean) from public, anon;
grant execute on function public.aparelho_voip_registrar(text, text, boolean) to authenticated;

-- -----------------------------------------------------------------------------
-- 3. O que foi mandado a cada aparelho, e o convite para atender
-- -----------------------------------------------------------------------------
-- O convite em si só existe no aviso que vai ao aparelho; aqui fica o hash. Vale para
-- uma ligação e uma pessoa, e só enquanto a ligação está viva.
create table if not exists app.voip_convites (
  hash        bytea primary key,
  chamada_id  uuid not null references public.wa_chamadas (id) on delete cascade,
  pessoa_id   uuid not null references public.profiles (id) on delete cascade,
  voip_token  text not null,
  criado_em   timestamptz not null default now(),
  -- O aparelho atendeu com ele: é esse aparelho que cuida da ligação dali em diante.
  usado_em    timestamptz,
  -- A pessoa tocou em Recusar neste aparelho: ele já parou de tocar, não recebe "parar".
  recusado_em timestamptz
);
create index if not exists voip_convites_chamada on app.voip_convites (chamada_id);
alter table app.voip_convites enable row level security;
revoke all on app.voip_convites from anon, authenticated;

create table if not exists app.voip_envios (
  chamada_id  uuid not null references public.wa_chamadas (id) on delete cascade,
  voip_token  text not null,
  evento      text not null check (evento in ('tocar', 'parar')),
  pessoa_id   uuid,
  criado_em   timestamptz not null default now(),
  -- A resposta da Apple: 200, ou o código e o motivo (`BadDeviceToken`, `Unregistered`).
  status      int,
  motivo      text,
  primary key (chamada_id, voip_token, evento)
);
alter table app.voip_envios enable row level security;
revoke all on app.voip_envios from anon, authenticated;
comment on table app.voip_envios is
  'Avisos de chamada (PushKit) mandados aos iPhones: um "tocar" e no máximo um "parar" por aparelho e ligação. Escrito por public.voip_a_enviar e public.voip_resultado.';

-- -----------------------------------------------------------------------------
-- 4. Quem toca e quem para (a Edge Function `voip-push` pergunta aqui)
-- -----------------------------------------------------------------------------
-- Decide pelo estado da ligação, e não pelo que o gatilho viu: duas cutucadas fora de
-- ordem chegam ao mesmo resultado, e nenhum aparelho recebe o mesmo aviso duas vezes.
create or replace function public.voip_a_enviar(p_chamada_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ch        public.wa_chamadas%rowtype;
  r         record;
  v_convite text;
  v_envios  jsonb := '[]'::jsonb;
begin
  select * into ch from public.wa_chamadas where id = p_chamada_id;
  if not found or ch.direcao <> 'recebida' then
    return jsonb_build_object('envios', '[]'::jsonb);
  end if;
  -- Uma rodada por vez para a mesma ligação.
  perform pg_advisory_xact_lock(hashtextextended('voip:' || p_chamada_id::text, 0));
  select * into ch from public.wa_chamadas where id = p_chamada_id;

  -- Registro de aviso, não histórico: uma semana basta.
  delete from app.voip_envios where criado_em < now() - interval '7 days';
  delete from app.voip_convites where criado_em < now() - interval '7 days';

  if ch.estado = 'tocando' then
    -- A Meta dá de 30 a 60 s para atender: depois disso não adianta tocar.
    if app.voip_ligado() and ch.tocou_em > now() - interval '60 seconds' then
      for r in
        select a.voip_token, a.voip_sandbox, a.pessoa_id, a.empresa_nome
          from public.aparelhos_push a
         where a.voip_token is not null
           and a.plataforma = 'ios'
           and a.pessoa_id in (select app.avisos_quem_atende())
           -- Quem desligou "Cliente ligando" em Avisos no celular não recebe a chamada.
           and not exists (select 1 from public.avisos_desligados d
                            where d.pessoa_id = a.pessoa_id and d.tipo = 'ligando')
           and not exists (select 1 from app.voip_envios e
                            where e.chamada_id = ch.id and e.voip_token = a.voip_token
                              and e.evento = 'tocar')
      loop
        v_convite := translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/=', '-_');
        insert into app.voip_convites (hash, chamada_id, pessoa_id, voip_token)
        values (extensions.digest(v_convite, 'sha256'), ch.id, r.pessoa_id, r.voip_token);
        insert into app.voip_envios (chamada_id, voip_token, evento, pessoa_id)
        values (ch.id, r.voip_token, 'tocar', r.pessoa_id);
        v_envios := v_envios || jsonb_build_object(
          'voip_token', r.voip_token, 'sandbox', r.voip_sandbox, 'evento', 'tocar',
          'convite', v_convite, 'empresa_nome', r.empresa_nome);
      end loop;
    end if;
  else
    -- Saiu de "tocando": para em todos os que tocaram, menos no aparelho que atendeu.
    -- Mesmo com a chave desligada no meio do caminho: o que tocou tem de parar.
    for r in
      select e.voip_token, coalesce(a.voip_sandbox, false) as voip_sandbox, e.pessoa_id
        from app.voip_envios e
        left join public.aparelhos_push a on a.voip_token = e.voip_token
       where e.chamada_id = ch.id and e.evento = 'tocar'
         -- O "tocar" que a Apple recusou não tocou: mandar "parar" faria a tela piscar.
         and (e.status is null or e.status = 200)
         and not exists (select 1 from app.voip_envios p
                          where p.chamada_id = ch.id and p.voip_token = e.voip_token
                            and p.evento = 'parar')
         and not exists (select 1 from app.voip_convites c
                          where c.chamada_id = ch.id and c.voip_token = e.voip_token
                            and (c.usado_em is not null or c.recusado_em is not null))
    loop
      insert into app.voip_envios (chamada_id, voip_token, evento, pessoa_id)
      values (ch.id, r.voip_token, 'parar', r.pessoa_id);
      v_envios := v_envios || jsonb_build_object(
        'voip_token', r.voip_token, 'sandbox', r.voip_sandbox, 'evento', 'parar');
    end loop;
  end if;

  return jsonb_build_object(
    'chamada_id', ch.id,
    'estado', ch.estado,
    'quem', ch.quem,
    'empresa', app.avisos_empresa(),
    'caminho', app.caminho_da_conversa(ch.conversation_id),
    'motivo', case when ch.estado in ('atendendo', 'em_curso') then 'atendida'
                   when ch.estado = 'perdida' then 'perdida'
                   when ch.estado = 'tocando' then null
                   else 'encerrada' end,
    'envios', v_envios);
end $$;
comment on function public.voip_a_enviar(uuid) is
  'Os avisos de chamada (PushKit) que faltam mandar para esta ligação: "tocar" aos iPhones de quem atende, com um convite por aparelho, ou "parar" aos que tocaram. Só para a Edge Function voip-push.';
revoke all on function public.voip_a_enviar(uuid) from public, anon, authenticated;
grant execute on function public.voip_a_enviar(uuid) to service_role;

-- O que a Apple respondeu. `Unregistered` (410) é o app apagado do aparelho: o endereço
-- de chamada é esquecido. Os outros erros ficam só anotados.
create or replace function public.voip_resultado(p_resultados jsonb) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  e        jsonb;
  v_n      integer := 0;
begin
  for e in select * from jsonb_array_elements(coalesce(p_resultados, '[]'::jsonb)) loop
    update app.voip_envios
       set status = (e ->> 'status')::int, motivo = left(e ->> 'motivo', 80)
     where chamada_id = (e ->> 'chamada_id')::uuid
       and voip_token = e ->> 'voip_token'
       and evento = e ->> 'evento';
    if (e ->> 'status')::int = 410 then
      update public.aparelhos_push set voip_token = null where voip_token = e ->> 'voip_token';
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function public.voip_resultado(jsonb) from public, anon, authenticated;
grant execute on function public.voip_resultado(jsonb) to service_role;

-- -----------------------------------------------------------------------------
-- 5. O gatilho: entrou tocando, ou saiu de tocando
-- -----------------------------------------------------------------------------
-- Só cutuca a função (o pedido sai depois do commit, pelo pg_net). Nunca falha: um
-- problema aqui não pode impedir o webhook da Meta de gravar a ligação.
create or replace function app.wa_chamadas_cutucar_aparelhos() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
begin
  if new.direcao <> 'recebida' then
    return null;
  end if;
  if tg_op = 'INSERT' and new.estado <> 'tocando' then
    return null;
  end if;
  if tg_op = 'UPDATE'
     and (new.estado is not distinct from old.estado
          or (old.estado <> 'tocando' and new.estado <> 'tocando')) then
    return null;
  end if;
  -- Para tocar, a chave tem de estar ligada. Para parar, basta ter tocado.
  if new.estado = 'tocando' and not app.voip_ligado() then
    return null;
  end if;
  if new.estado <> 'tocando'
     and not exists (select 1 from app.voip_envios e where e.chamada_id = new.id) then
    return null;
  end if;
  select s.value ->> 'funcao_url' into v_url from public.app_settings s where s.key = 'ligacao.app';
  if v_url is null or v_url !~ '^https?://[A-Za-z0-9.:-]+(/[A-Za-z0-9/_-]*)?$' then
    return null;
  end if;
  perform net.http_post(
    url := rtrim(v_url, '/') || '/voip-push',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object('chamada_id', new.id),
    timeout_milliseconds := 10000);
  return null;
exception when others then
  raise warning 'wa_chamadas_cutucar_aparelhos: %', sqlerrm;
  return null;
end $$;
revoke all on function app.wa_chamadas_cutucar_aparelhos() from public, anon, authenticated;

drop trigger if exists wa_chamadas_cutucar_aparelhos on public.wa_chamadas;
create trigger wa_chamadas_cutucar_aparelhos
  after insert or update of estado on public.wa_chamadas
  for each row execute function app.wa_chamadas_cutucar_aparelhos();

-- -----------------------------------------------------------------------------
-- 6. Atender pelo celular, com o convite
-- -----------------------------------------------------------------------------
-- A porta da Edge Function `wa-chamada-app`. As regras são as do navegador
-- (`wa_chamada_atender`, `wa_chamada_autorizar`, `wa_chamada_soltar`), com a pessoa do
-- convite no lugar de `auth.uid()`:
--   atender    reserva a ligação que ainda toca; devolve a oferta da Meta
--   autorizar  pre_aceitar e aceitar: a ligação está reservada para esta pessoa
--   encerrar   desligar a ligação desta pessoa
--   soltar     a rede caiu antes de atender: volta a tocar para quem está com o CRM aberto
--   recusar    Recusar neste iPhone: só ele para de tocar (e não recebe o "parar")
--   estado     o app pergunta, tocando e durante a ligação, se a ligação continua
create or replace function public.wa_chamada_app(p_convite text, p_acao text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c   app.voip_convites%rowtype;
  ch  public.wa_chamadas%rowtype;
begin
  if p_convite is null or p_convite !~ '^[A-Za-z0-9_-]{40,60}$' then
    return jsonb_build_object('ok', false, 'motivo', 'convite_invalido');
  end if;
  select * into c from app.voip_convites where hash = extensions.digest(p_convite, 'sha256');
  if not found or c.criado_em < now() - interval '12 hours' then
    return jsonb_build_object('ok', false, 'motivo', 'convite_invalido');
  end if;
  -- As mesmas pessoas de app.can_write(), mas pelo convite e ativas hoje.
  if not app.wa_ligacao_ligada()
     or not exists (select 1 from public.team_directory t
                     where t.id = c.pessoa_id and t.is_active
                       and t.role in ('admin', 'gestor', 'sdr', 'embaixador')) then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;

  if p_acao = 'atender' then
    begin
      update public.wa_chamadas
         set estado = 'atendendo', atendida_por = c.pessoa_id
       where id = c.chamada_id and direcao = 'recebida' and estado = 'tocando'
      returning * into ch;
    exception when unique_violation then
      return jsonb_build_object('ok', false, 'motivo', 'voce_ja_esta_em_ligacao');
    end;
    if not found then
      select * into ch from public.wa_chamadas where id = c.chamada_id;
      -- O mesmo aparelho repetiu o pedido (a rede caiu no meio): a reserva é dele.
      if not (ch.estado = 'atendendo' and ch.atendida_por = c.pessoa_id and c.usado_em is not null) then
        return jsonb_build_object('ok', false, 'motivo',
          case when ch.estado in ('atendendo', 'em_curso') then 'ja_atendida' else 'encerrada' end);
      end if;
    end if;
    update app.voip_convites set usado_em = coalesce(usado_em, now()) where hash = c.hash;
    return jsonb_build_object('ok', true, 'chamada_id', ch.id, 'oferta_sdp', ch.oferta_sdp,
                              'quem', ch.quem);
  end if;

  select * into ch from public.wa_chamadas where id = c.chamada_id;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'ligacao_desconhecida');
  end if;

  if p_acao = 'autorizar' then
    if ch.estado = 'atendendo' and ch.atendida_por = c.pessoa_id then
      return jsonb_build_object('ok', true, 'chamada_id', ch.id);
    end if;
    return jsonb_build_object('ok', false, 'motivo', 'acao_nao_permitida');
  elsif p_acao = 'encerrar' then
    if ch.estado in ('atendendo', 'em_curso') and ch.atendida_por = c.pessoa_id then
      return jsonb_build_object('ok', true, 'chamada_id', ch.id);
    end if;
    return jsonb_build_object('ok', false, 'motivo', 'acao_nao_permitida');
  elsif p_acao = 'soltar' then
    update public.wa_chamadas
       set estado = 'tocando', atendida_por = null
     where id = ch.id and estado = 'atendendo' and atendida_por = c.pessoa_id;
    return jsonb_build_object('ok', found, 'chamada_id', ch.id);
  elsif p_acao = 'recusar' then
    update app.voip_convites set recusado_em = coalesce(recusado_em, now()) where hash = c.hash;
    return jsonb_build_object('ok', true, 'chamada_id', ch.id);
  elsif p_acao = 'estado' then
    return jsonb_build_object('ok', true, 'chamada_id', ch.id, 'estado', ch.estado,
                              'minha', ch.atendida_por is not distinct from c.pessoa_id);
  end if;
  return jsonb_build_object('ok', false, 'motivo', 'acao_desconhecida');
end $$;
comment on function public.wa_chamada_app(text, text) is
  'O app do iPhone atende, aceita, desliga ou acompanha a ligação pelo WhatsApp com o convite que veio no aviso de chamada. Só para a Edge Function wa-chamada-app.';
revoke all on function public.wa_chamada_app(text, text) from public, anon, authenticated;
grant execute on function public.wa_chamada_app(text, text) to service_role;

-- -----------------------------------------------------------------------------
-- 7. O aviso comum "está ligando" sai só para quem não tem a tela de chamada
-- -----------------------------------------------------------------------------
-- Cópia de app.avisos_push_enviar (20261106210000, conferida igual à de produção em
-- 23/11/2026) com UMA mudança: com a ligação no app ligada, o aviso "ligando" não vai
-- ao aparelho que tem endereço de chamada (ele já está tocando na tela de chamada).
create or replace function app.avisos_push_enviar() returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mensagens jsonb;
  v_tokens    text[];
  v_ids       bigint[];
  v_pedido    bigint;
  -- Das 8h às 20h, em Fortaleza, o aviso toca; fora, chega sem som (menos o lembrete).
  v_com_som   boolean := extract(hour from now() at time zone 'America/Fortaleza') between 8 and 19;
  v_voip      boolean := app.voip_ligado();
begin
  -- Aviso velho não sai: o celular avisando 20 minutos depois só atrapalha.
  update app.push_fila set enviado_em = now(), resultado = 'vencido'
   where enviado_em is null
     and (criado_em < now() - interval '10 minutes'
          -- "Está ligando" depois de 1 minuto já não é verdade.
          or (tipo = 'ligando' and criado_em < now() - interval '1 minute'));
  -- O que a pessoa desligou para si.
  update app.push_fila f set enviado_em = now(), resultado = 'desligado'
   where f.enviado_em is null
     and exists (select 1 from public.avisos_desligados d
                  where d.pessoa_id = f.pessoa_id and d.tipo = f.tipo);
  -- Quem não tem aparelho: nada a mandar.
  update app.push_fila f set enviado_em = now(), resultado = 'sem_aparelho'
   where f.enviado_em is null
     and not exists (select 1 from public.aparelhos_push a where a.pessoa_id = f.pessoa_id);
  -- Todos os aparelhos da pessoa tocam na tela de chamada: o aviso comum sobra.
  if v_voip then
    update app.push_fila f set enviado_em = now(), resultado = 'tela_de_chamada'
     where f.enviado_em is null
       and f.tipo = 'ligando'
       and not exists (select 1 from public.aparelhos_push a
                        where a.pessoa_id = f.pessoa_id and a.voip_token is null);
  end if;

  -- Até 100 por pedido, o teto do Expo.
  with lote as (
    select f.id, f.tipo, f.corpo, f.caminho, a.token, a.empresa, a.empresa_nome
      from app.push_fila f
      join public.aparelhos_push a on a.pessoa_id = f.pessoa_id
     where f.enviado_em is null
       and not (v_voip and f.tipo = 'ligando' and a.voip_token is not null)
     order by f.id
     limit 100
  )
  select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'to', l.token,
           'title', l.empresa_nome,
           'body', l.corpo,
           'sound', case when v_com_som or l.tipo = 'lembrete' then 'default' end,
           'priority', 'high',
           -- O celular desligado não recebe "está ligando" quando volta: só no primeiro minuto.
           'ttl', case when l.tipo = 'ligando' then 60 end,
           'data', jsonb_build_object('empresa', l.empresa, 'caminho', l.caminho, 'tipo', l.tipo)
         )) order by l.id, l.token),
         array_agg(l.token order by l.id, l.token),
         array_agg(distinct l.id)
    into v_mensagens, v_tokens, v_ids
    from lote l;

  if v_mensagens is null then
    return 0;
  end if;

  select net.http_post(
           url := 'https://exp.host/--/api/v2/push/send',
           headers := jsonb_build_object('Content-Type', 'application/json',
                                         'Accept', 'application/json'),
           body := v_mensagens,
           timeout_milliseconds := 15000)
    into v_pedido;

  insert into app.push_envios (pedido_id, tokens) values (v_pedido, v_tokens);
  update app.push_fila set enviado_em = now(), resultado = 'enviado'
   where id = any (v_ids);
  return jsonb_array_length(v_mensagens);
end $$;
revoke all on function app.avisos_push_enviar() from public, anon, authenticated;

notify pgrst, 'reload schema';

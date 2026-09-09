-- =====================================================================
-- 20260909130000 — As rotas do servidor ganham porta em `public`
--
-- Defeito meu, descoberto em produção quando "Procurar no Google" respondeu
-- `ficha_inexistente` para uma ficha que existe.
--
-- ---------------------------------------------------------------------------
-- O ERRO
-- ---------------------------------------------------------------------------
-- Pus as funções de servidor em `app` pelo motivo certo — o PostgREST não expõe
-- esse schema (`config.toml`: `[api].schemas = public, graphql_public`), então
-- nem o navegador nem uma chave vazada alcançam o que mora lá. E aí escrevi as
-- rotas do Next chamando `admin.schema('app').rpc(...)`, que fala com o banco
-- **pelo PostgREST**. Ou seja: usei a porta que eu mesmo tinha trancado.
--
-- O PostgREST responde `PGRST106 — Only the following schemas are exposed`, com
-- HTTP 406. As rotas ignoravam o `error` e liam só o `data`, que vinha nulo —
-- e um `data` nulo virava "a ficha não existe". Duas falhas empilhadas: a
-- chamada impossível e o erro engolido.
--
-- Isso derrubava TUDO que escrevi em 08 e 09/09 do lado servidor: a busca de
-- telefone e a integração inteira com o Google Agenda. A agenda nunca tinha sido
-- exercitada de ponta a ponta (falta a chave do Google), então o defeito ficou
-- escondido lá.
--
-- ---------------------------------------------------------------------------
-- A CORREÇÃO, QUE JÁ ERA O PADRÃO DA CASA
-- ---------------------------------------------------------------------------
-- A migração 20260904001802 resolveu exatamente isto para as funções de fila:
-- invólucro em `public`, corpo de uma linha, `security invoker`, e `execute`
-- concedido SÓ a `service_role` — nem `anon`, nem `authenticated`.
--
-- `security invoker` é o detalhe que mantém a garantia: o invólucro não amplia
-- privilégio nenhum, porque quem é `security definer` é a função interna, e o
-- `grant` dela continua barrando qualquer papel que não seja `service_role`. Se
-- um dia alguém conceder um destes invólucros por engano a `authenticated`, a
-- função de dentro recusa do mesmo jeito.
--
-- Mesmo nome nos dois schemas, de propósito: o invólucro é passagem pura, e
-- renomeá-lo obrigaria quem lê a rota a procurar a correspondência. Com
-- `search_path = ''` e chamada qualificada, não há ambiguidade possível.
-- =====================================================================


-- ---------------------------------------------------------------------------
-- 1. Busca de telefone
-- ---------------------------------------------------------------------------

create or replace function public.ficha_para_busca_de_telefone(p_organization_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select app.ficha_para_busca_de_telefone(p_organization_id)
$$;
comment on function public.ficha_para_busca_de_telefone(uuid) is
  'Invólucro de app.ficha_para_busca_de_telefone para a rota do servidor, que fala com o banco pelo PostgREST (o schema app não é exposto). Só service_role executa.';
revoke all on function public.ficha_para_busca_de_telefone(uuid) from public, anon, authenticated;
grant execute on function public.ficha_para_busca_de_telefone(uuid) to service_role;

create or replace function public.registrar_busca_de_telefone(
  p_organization_id uuid, p_place_id text, p_achou boolean)
returns jsonb language sql volatile security invoker set search_path = '' as $$
  select app.registrar_busca_de_telefone(p_organization_id, p_place_id, p_achou)
$$;
comment on function public.registrar_busca_de_telefone(uuid, text, boolean) is
  'Invólucro de app.registrar_busca_de_telefone. Só service_role executa.';
revoke all on function public.registrar_busca_de_telefone(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.registrar_busca_de_telefone(uuid, text, boolean) to service_role;


-- ---------------------------------------------------------------------------
-- 2. Ligação com a agenda Google
-- ---------------------------------------------------------------------------

create or replace function public.agenda_google_guardar(
  p_user_id uuid, p_refresh_token text, p_email_google text, p_escopos text[])
returns jsonb language sql volatile security invoker set search_path = '' as $$
  select app.agenda_google_guardar(p_user_id, p_refresh_token, p_email_google, p_escopos)
$$;
comment on function public.agenda_google_guardar(uuid, text, text, text[]) is
  'Invólucro de app.agenda_google_guardar. Só service_role executa: guardar refresh token é o que a pessoa logada NÃO pode fazer sozinha.';
revoke all on function public.agenda_google_guardar(uuid, text, text, text[]) from public, anon, authenticated;
grant execute on function public.agenda_google_guardar(uuid, text, text, text[]) to service_role;

-- Devolve o refresh token em claro. É a função mais sensível deste arquivo, e o
-- `revoke` abaixo é o que impede que uma chave `anon` vazada a alcance.
create or replace function public.agenda_google_token(p_user_id uuid)
returns text language sql stable security invoker set search_path = '' as $$
  select app.agenda_google_token(p_user_id)
$$;
comment on function public.agenda_google_token(uuid) is
  'Invólucro de app.agenda_google_token. Devolve o refresh token em claro — só service_role executa.';
revoke all on function public.agenda_google_token(uuid) from public, anon, authenticated;
grant execute on function public.agenda_google_token(uuid) to service_role;

create or replace function public.agenda_google_token_do_evento(p_task_id uuid)
returns text language sql stable security invoker set search_path = '' as $$
  select app.agenda_google_token_do_evento(p_task_id)
$$;
comment on function public.agenda_google_token_do_evento(uuid) is
  'Invólucro de app.agenda_google_token_do_evento. Devolve o refresh token de quem criou o evento — só service_role executa.';
revoke all on function public.agenda_google_token_do_evento(uuid) from public, anon, authenticated;
grant execute on function public.agenda_google_token_do_evento(uuid) to service_role;

create or replace function public.agenda_google_falhou(
  p_user_id uuid, p_erro text, p_revogar boolean)
returns void language sql volatile security invoker set search_path = '' as $$
  select app.agenda_google_falhou(p_user_id, p_erro, p_revogar)
$$;
comment on function public.agenda_google_falhou(uuid, text, boolean) is
  'Invólucro de app.agenda_google_falhou. Só service_role executa.';
revoke all on function public.agenda_google_falhou(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.agenda_google_falhou(uuid, text, boolean) to service_role;


-- ---------------------------------------------------------------------------
-- 3. Eventos espelhados
-- ---------------------------------------------------------------------------

create or replace function public.agenda_dados_do_evento(p_task_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select app.agenda_dados_do_evento(p_task_id)
$$;
comment on function public.agenda_dados_do_evento(uuid) is
  'Invólucro de app.agenda_dados_do_evento. Só service_role executa.';
revoke all on function public.agenda_dados_do_evento(uuid) from public, anon, authenticated;
grant execute on function public.agenda_dados_do_evento(uuid) to service_role;

create or replace function public.compromisso_do_google_gravar(
  p_task_id uuid, p_evento_id text, p_agenda_id text,
  p_meet_url text, p_link_html text, p_criado_por uuid)
returns jsonb language sql volatile security invoker set search_path = '' as $$
  select app.compromisso_do_google_gravar(p_task_id, p_evento_id, p_agenda_id,
                                          p_meet_url, p_link_html, p_criado_por)
$$;
comment on function public.compromisso_do_google_gravar(uuid, text, text, text, text, uuid) is
  'Invólucro de app.compromisso_do_google_gravar. Só service_role executa: quem grava o espelho é o servidor, depois que o Google respondeu.';
revoke all on function public.compromisso_do_google_gravar(uuid, text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.compromisso_do_google_gravar(uuid, text, text, text, text, uuid) to service_role;

create or replace function public.compromisso_do_google_ler(p_task_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select app.compromisso_do_google_ler(p_task_id)
$$;
comment on function public.compromisso_do_google_ler(uuid) is
  'Invólucro de app.compromisso_do_google_ler. Só service_role executa.';
revoke all on function public.compromisso_do_google_ler(uuid) from public, anon, authenticated;
grant execute on function public.compromisso_do_google_ler(uuid) to service_role;

create or replace function public.compromisso_do_google_remanejar(
  p_task_antiga uuid, p_novo_horario timestamptz)
returns jsonb language sql volatile security invoker set search_path = '' as $$
  select app.compromisso_do_google_remanejar(p_task_antiga, p_novo_horario)
$$;
comment on function public.compromisso_do_google_remanejar(uuid, timestamptz) is
  'Invólucro de app.compromisso_do_google_remanejar. Só service_role executa.';
revoke all on function public.compromisso_do_google_remanejar(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.compromisso_do_google_remanejar(uuid, timestamptz) to service_role;

create or replace function public.compromisso_do_google_esquecer(p_task_id uuid)
returns jsonb language sql volatile security invoker set search_path = '' as $$
  select app.compromisso_do_google_esquecer(p_task_id)
$$;
comment on function public.compromisso_do_google_esquecer(uuid) is
  'Invólucro de app.compromisso_do_google_esquecer. Só service_role executa.';
revoke all on function public.compromisso_do_google_esquecer(uuid) from public, anon, authenticated;
grant execute on function public.compromisso_do_google_esquecer(uuid) to service_role;

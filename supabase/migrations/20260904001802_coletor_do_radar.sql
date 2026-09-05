-- =====================================================================
-- 20260904001802 — O coletor do Radar: a esteira aberta para o worker
--
-- A migração 20260904001600 construiu a esteira inteira (filas pgmq, dedup,
-- backoff, dead-letter, captura → registro → candidato) e deixou as quatro
-- funções de fila em `app.*`. Só que `app` NÃO está exposto ao PostgREST
-- (supabase/config.toml, [api].schemas = public, graphql_public): o worker da
-- máquina dedicada fala com o banco por HTTPS (ADR-04 — recepção em nuvem,
-- processamento local), e por HTTPS ele não alcança `app.esteira_ler`.
--
-- Esta migração faz três coisas, nenhuma delas nova:
--   1. Quatro invólucros em `public` para as funções de fila que já existem.
--      Nada de lógica: `security invoker`, corpo de uma linha, e execução
--      concedida SÓ a `service_role` — nem `anon`, nem `authenticated`. Quem
--      abre a fila é o worker; uma pessoa logada continua sem poder tocá-la.
--   2. O catálogo de coleta do Casamentos.com.br dentro de `sources.config`.
--      QUE páginas coletar é dado de operação (muda sem deploy); COMO extrair
--      é código (o adaptador no worker). O caminho de cada listagem sai do
--      anexo R03 §2.1, e todos são permitidos pelo robots.txt da fonte — o
--      worker confere de novo, a cada corrida, antes de buscar qualquer coisa.
--   3. O mapa categoria-da-fonte → categoria do CRM (`source_category_map`),
--      só para os slugs em que a correspondência é óbvia. `cabine-de-fotos`
--      fica DE FORA de propósito: sem mapa a categoria chega nula e quem
--      revisa escolhe, que é a regra da 001600 ("categoria não mapeada não
--      vira palpite").
--
-- Idempotente: `create or replace`, `on conflict do nothing`, `jsonb_set`.
-- =====================================================================


-- ---------------------------------------------------------------------------
-- 1. As quatro bocas da fila, em `public`, só para o worker
-- ---------------------------------------------------------------------------
-- `security invoker` de propósito: quem chama já é `service_role`, e a função
-- interna (`app.esteira_*`) é que é `security definer`. Assim o invólucro não
-- amplia privilégio nenhum — se um dia alguém conceder um destes por engano a
-- `authenticated`, o `grant execute` da função interna continua barrando.

create or replace function public.esteira_fila_enfileirar(
  p_queue text, p_payload jsonb, p_key text,
  p_batch_id uuid default null, p_delay int default 0
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select app.esteira_enfileirar(p_queue, p_payload, p_key, p_batch_id, p_delay)
$$;
comment on function public.esteira_fila_enfileirar(text,jsonb,text,uuid,int) is
  'Invólucro de app.esteira_enfileirar para o worker, que fala com o banco por HTTPS (o schema app não é exposto ao PostgREST). Só service_role executa.';

-- `app.esteira_ler` devolve `setof pgmq.message_record`, e o tipo mora no schema
-- `pgmq`, que o PostgREST também não enxerga. Aqui a leitura vira um array jsonb
-- com os quatro campos que o worker usa: id da mensagem, quantas vezes já foi
-- entregue, quando entrou e o corpo.
create or replace function public.esteira_fila_ler(p_queue text, p_qty int default 1)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'msg_id', m.msg_id,
           'entregas', m.read_ct,
           'enfileirada_em', m.enqueued_at,
           'mensagem', m.message) order by m.msg_id), '[]'::jsonb)
    from app.esteira_ler(p_queue, p_qty) m
$$;
comment on function public.esteira_fila_ler(text,int) is
  'Invólucro de app.esteira_ler: devolve as mensagens visíveis como array jsonb (o tipo pgmq.message_record não é exposto ao PostgREST). Aplica o visibility timeout configurado na fila.';

create or replace function public.esteira_fila_concluir(p_queue text, p_msg_id bigint, p_key text)
returns boolean
language sql
volatile
security invoker
set search_path = ''
as $$
  select app.esteira_concluir(p_queue, p_msg_id, p_key)
$$;
comment on function public.esteira_fila_concluir(text,bigint,text) is
  'Invólucro de app.esteira_concluir: arquiva a mensagem e fecha a chave de idempotência.';

create or replace function public.esteira_fila_falhar(
  p_queue text, p_msg_id bigint, p_key text, p_erro text
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select app.esteira_falhar(p_queue, p_msg_id, p_key, p_erro)
$$;
comment on function public.esteira_fila_falhar(text,bigint,text,text) is
  'Invólucro de app.esteira_falhar: backoff exponencial até o teto de tentativas da fila e, passado o teto, dead-letter com o erro junto.';

revoke all on function public.esteira_fila_enfileirar(text,jsonb,text,uuid,int) from public, anon, authenticated;
revoke all on function public.esteira_fila_ler(text,int)                        from public, anon, authenticated;
revoke all on function public.esteira_fila_concluir(text,bigint,text)           from public, anon, authenticated;
revoke all on function public.esteira_fila_falhar(text,bigint,text,text)        from public, anon, authenticated;

grant execute on function public.esteira_fila_enfileirar(text,jsonb,text,uuid,int) to service_role;
grant execute on function public.esteira_fila_ler(text,int)                        to service_role;
grant execute on function public.esteira_fila_concluir(text,bigint,text)           to service_role;
grant execute on function public.esteira_fila_falhar(text,bigint,text,text)        to service_role;


-- ---------------------------------------------------------------------------
-- 2. Fechar o lote: o worker precisa dizer "comecei" e "terminei"
-- ---------------------------------------------------------------------------
-- `import_batches` nasce em 'previa' (esteira_abrir_lote). Quem move o lote para
-- 'rodando' e depois para 'concluido'/'falhou' é o coletor, e ele precisa fazer
-- isso pela mesma porta estreita de sempre — não por UPDATE solto na tabela.
create or replace function public.esteira_estado_lote(
  p_batch_id uuid,
  p_status   text,
  p_stats    jsonb default null,
  p_error    text  default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.import_batches;
begin
  if p_status not in ('na_fila','rodando','concluido','falhou') then
    return jsonb_build_object('ok', false, 'reason', 'status_invalido');
  end if;

  update public.import_batches b
     set status      = p_status,
         stats       = coalesce(p_stats, b.stats),
         error       = coalesce(nullif(trim(coalesce(p_error, '')), ''), b.error),
         started_at  = case when p_status = 'rodando' then coalesce(b.started_at, now())
                            else b.started_at end,
         finished_at = case when p_status in ('concluido','falhou') then now()
                            else b.finished_at end
   where b.id = p_batch_id
  returning * into v;

  if v.id is null then
    return jsonb_build_object('ok', false, 'reason', 'lote_inexistente');
  end if;
  return jsonb_build_object('ok', true, 'batch_id', v.id, 'status', v.status);
end $$;
comment on function public.esteira_estado_lote(uuid,text,jsonb,text) is
  'Move o lote de coleta entre na_fila → rodando → concluido/falhou e guarda as estatísticas da corrida. Só o worker (service_role) chama.';

revoke all on function public.esteira_estado_lote(uuid,text,jsonb,text) from public, anon, authenticated;
grant execute on function public.esteira_estado_lote(uuid,text,jsonb,text) to service_role;


-- ---------------------------------------------------------------------------
-- 3. Catálogo de coleta do Casamentos.com.br (R03 §2.1)
-- ---------------------------------------------------------------------------
-- Cada entrada é uma página de listagem categoria × cidade. A paginação NÃO está
-- aqui: a própria página diz onde continua, no `<link rel="next">`, e é ele que o
-- worker segue — inventar `--2`, `--3` no código produziria requisição para
-- página que não existe, que é justamente o tipo de tráfego que a fonte não deve
-- receber de nós.
update public.sources s
   set config = jsonb_set(
                  jsonb_set(s.config, '{collector,agente}',
                            to_jsonb('KomuneBot/1.0 (+https://komune.app.br; CRM de captação da Komune)'::text), true),
                  '{collector,catalogo}',
                  '[
                     {"categoria_origem": "cerimonialista",         "caminho": "/cerimonialista/rio-grande-do-norte/natal"},
                     {"categoria_origem": "espaco-casamento",       "caminho": "/espaco-casamento/rio-grande-do-norte/natal"},
                     {"categoria_origem": "fotografo-casamento",    "caminho": "/fotografo-casamento/rio-grande-do-norte/natal"},
                     {"categoria_origem": "filmagem-casamento",     "caminho": "/filmagem-casamento/rio-grande-do-norte/natal"},
                     {"categoria_origem": "buffet-casamento",       "caminho": "/buffet-casamento/rio-grande-do-norte/natal"},
                     {"categoria_origem": "musica-de-casamento",    "caminho": "/musica-de-casamento/rio-grande-do-norte/natal"},
                     {"categoria_origem": "decoracao-casamento",    "caminho": "/decoracao-casamento/rio-grande-do-norte/natal"},
                     {"categoria_origem": "doces-casamento",        "caminho": "/doces-casamento/rio-grande-do-norte/natal"},
                     {"categoria_origem": "bolo-casamento",         "caminho": "/bolo-casamento/rio-grande-do-norte/natal"},
                     {"categoria_origem": "convites-de-casamento",  "caminho": "/convites-de-casamento/rio-grande-do-norte/natal"},
                     {"categoria_origem": "lembrancas-de-casamento","caminho": "/lembrancas-de-casamento/rio-grande-do-norte/natal"},
                     {"categoria_origem": "florista-casamento",     "caminho": "/florista-casamento/rio-grande-do-norte/natal"},
                     {"categoria_origem": "carros-casamento",       "caminho": "/carros-casamento/rio-grande-do-norte/natal"},
                     {"categoria_origem": "animacao-festa",         "caminho": "/animacao-festa/rio-grande-do-norte/natal"},
                     {"categoria_origem": "beleza-noivas",          "caminho": "/beleza-noivas/rio-grande-do-norte/natal"},
                     {"categoria_origem": "celebrante",             "caminho": "/celebrante/rio-grande-do-norte/natal"},
                     {"categoria_origem": "cabine-de-fotos",        "caminho": "/cabine-de-fotos/rio-grande-do-norte/natal"},
                     {"categoria_origem": "bebidas-casamento",      "caminho": "/bebidas-casamento/rio-grande-do-norte/natal"}
                   ]'::jsonb,
                  true)
 where s.slug = 'casamentos_com_br';


-- ---------------------------------------------------------------------------
-- 4. Mapa da categoria da fonte → categoria do CRM
-- ---------------------------------------------------------------------------
-- Só o que é evidente. `cabine-de-fotos` não entra: cabine é serviço de foto para
-- uns e brinquedo de festa para outros, e chutar aqui contamina o funil inteiro
-- sem que ninguém tenha decidido. Sem mapa, `category_id` chega nulo e a fila de
-- revisão pergunta — que é o comportamento que a 001600 desenhou.
insert into public.source_category_map (source_id, category_source, category_id)
select s.id, m.categoria_origem, c.id
  from public.sources s
  join (values
          ('cerimonialista',          'cerimonialistas_assessorias'),
          ('espaco-casamento',        'locais_saloes_chacaras_hoteis'),
          ('salao-casamento',         'locais_saloes_chacaras_hoteis'),
          ('restaurante-casamento',   'locais_saloes_chacaras_hoteis'),
          ('fazenda-casamento',       'locais_saloes_chacaras_hoteis'),
          ('hotel-casamento',         'locais_saloes_chacaras_hoteis'),
          ('fotografo-casamento',     'fotografia_video'),
          ('filmagem-casamento',      'fotografia_video'),
          ('buffet-casamento',        'buffet_adulto_corporativo'),
          ('musica-de-casamento',     'djs_bandas_musicos'),
          ('dj-para-casamento',       'djs_bandas_musicos'),
          ('decoracao-casamento',     'decoracao_flores'),
          ('florista-casamento',      'decoracao_flores'),
          ('doces-casamento',         'doces_bolos_confeitaria'),
          ('bolo-casamento',          'doces_bolos_confeitaria'),
          ('convites-de-casamento',   'celebrante_beleza_convites_staff'),
          ('lembrancas-de-casamento', 'celebrante_beleza_convites_staff'),
          ('beleza-noivas',           'celebrante_beleza_convites_staff'),
          ('celebrante',              'celebrante_beleza_convites_staff'),
          ('carros-casamento',        'celebrante_beleza_convites_staff'),
          ('animacao-festa',          'recreadores_animadores'),
          ('bebidas-casamento',       'bar_drinks_chopp'),
          ('tendas-casamentos',       'tendas_estruturas_palcos')
       ) as m(categoria_origem, categoria_crm) on true
  join public.categories c on c.slug = m.categoria_crm
 where s.slug = 'casamentos_com_br'
on conflict (source_id, category_source) do update
  set category_id = excluded.category_id;


-- ---------------------------------------------------------------------------
-- 5. O worker não é "papel leitura" (defeito encontrado na primeira coleta real)
-- ---------------------------------------------------------------------------
-- Vários guardas de função `security definer` foram escritos assim:
--
--     -- Sem claims = service_role/workers/pg_cron: passa.
--     if current_setting('request.jwt.claims', true) is not null and not app.can_write() then
--       raise exception 'Papel % não ...', app.role() using errcode = '42501';
--
-- A intenção estava certa. A premissa, não: **o worker também manda um JWT**. A
-- chave `service_role` é um JWT assinado, o PostgREST põe as claims dele em
-- `request.jwt.claims`, e o guarda entra na primeira metade da condição. Aí
-- `app.role()` procura `app_metadata.app_role`, não acha (a chave de serviço não
-- tem perfil), cai no padrão de menor privilégio — `leitura` — e o coletor leva
-- 42501 na cara. Foi exatamente o que aconteceu ao rodar a primeira coleta real
-- contra a stack local, duas vezes:
--   `esteira_abrir_lote`   → "Papel leitura não abre lote de ingestão"
--   `app.find_org_matches` → "Papel leitura não consulta candidatos a duplicata"
--      (chamada de dentro de `app.resolver_source_record`, na etapa final da esteira)
--
-- O conserto certo é em `app.can_write()`, e não em cada guarda, porque a
-- afirmação "service_role não escreve na base" já era falsa de qualquer forma:
-- `service_role` é BYPASSRLS no Postgres — ele escreve em tudo, sempre escreveu,
-- e é assim que a esteira inteira grava `raw_capture` e `source_record`. O guarda
-- que dizia o contrário não protegia nada: só quebrava o único chamador honesto.
-- Depois desta migração ele passa a dizer a verdade.
--
-- O que NÃO muda: nenhuma política de RLS. Todas elas são `to authenticated`, e
-- `service_role` nunca é avaliado por elas. E ninguém logado no navegador
-- consegue a claim `role: service_role` — quem a põe é o PostgREST, a partir de
-- uma chave que só existe na máquina dedicada e nos segredos das Edge Functions.

create or replace function app.e_o_worker()
returns boolean
language sql
stable
set search_path = ''
as $$
  -- Pela CLAIM do JWT, e não por `current_user`: dentro de uma função
  -- `security definer` o `current_user` já é o DONO da função (postgres), e não
  -- quem chamou — foi assim que a primeira versão desta função respondeu "falso"
  -- para o próprio worker. A claim `role` é posta pelo PostgREST a partir do JWT
  -- que ele mesmo verificou, e sobrevive à troca de dono.
  select coalesce(auth.jwt() ->> 'role', '') = 'service_role'
$$;
comment on function app.e_o_worker() is
  'Verdadeiro quando quem chama é o service_role (worker da máquina dedicada ou Edge Function), e não uma pessoa autenticada. Lê a claim role do JWT, porque em security definer o current_user já é o dono da função.';
revoke all on function app.e_o_worker() from public, anon;
grant execute on function app.e_o_worker() to authenticated, service_role;

create or replace function app.can_write()
returns boolean language sql stable set search_path = '' as $$
  select app.e_o_worker()
      or app.role() in ('admin'::app.user_role, 'gestor'::app.user_role,
                        'sdr'::app.user_role, 'embaixador'::app.user_role)
$$;
comment on function app.can_write() is
  'Quem escreve na base de parceiros: admin, gestor, sdr, embaixador — e o worker (service_role), que já é BYPASSRLS e escreve de qualquer maneira. leitura e financeiro nunca escrevem.';

-- O PostgREST guarda um cache do catálogo; função nova só é alcançável por HTTP
-- depois deste aviso. Sem ele, o worker recebe "Could not find the function ...
-- in the schema cache" mesmo com tudo criado.
notify pgrst, 'reload schema';

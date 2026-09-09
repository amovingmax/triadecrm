-- =====================================================================
-- 20260909140000 — As três guardas que faltavam
--
-- Três furos de permissão achados numa varredura do banco. Não têm nada em
-- comum no assunto — dicionário da integração, relatório de segunda, papel do
-- JWT —, mas têm em comum o formato: em todos, o papel `leitura` faz alguma
-- coisa que o produto diz que ele não faz. Vêm juntos porque a correção de cada
-- um é curta e porque `leitura` é o papel do encarregado de LGPD, do Dennis e
-- de quem entra só para olhar: é o papel em que um privilégio a mais passa mais
-- tempo sem ser notado.
--
-- ---------------------------------------------------------------------------
-- 1. `public.komune_event_map` estava sem RLS, e qualquer autenticado escrevia
-- ---------------------------------------------------------------------------
-- A migração 20260904001810 criou a tabela (linha 498) e concedeu só o select:
--
--     grant select on public.komune_event_map to authenticated;
--
-- O que ela esqueceu foi o `alter table ... enable row level security`. Era a
-- única tabela de `public` sem RLS ligada. E `grant select` não retira nada: os
-- INSERT/UPDATE/DELETE já tinham chegado antes, pela `alter default privileges`
-- da migração 20260904000500 (linha 25), que dá as quatro operações de TODA
-- tabela nova de `public` a `authenticated` e a `service_role`.
--
-- Sem RLS, o privilégio de tabela é a palavra final. Resultado: qualquer pessoa
-- logada — inclusive o papel `leitura`, que o produto impede de registrar até
-- uma atividade — podia reescrever o dicionário. E o dicionário não é enfeite:
-- `app.komune_aplicar_evento` (mesma migração, linha 586) faz
--
--     select * into v_map from public.komune_event_map where external = v_evt;
--
-- e é essa linha que decide o que um webhook da Komune faz com o pré-cadastro:
-- qual evento entra na linha do tempo do onboarding e qual campo é atualizado.
-- Trocar `supplier.published → published` por outra coisa, ou apagar a linha,
-- não derruba a entrega — ela é aceita, registrada e ignorada, de propósito.
-- Ou seja: o estrago seria silencioso, e a Komune continuaria respondendo 200.
--
-- A CORREÇÃO. Ligar a RLS e dar UMA política, de leitura, `using (true)`: isto
-- é catálogo, no mesmo espírito de `categories`, `cities` e `sources`, que a
-- 000500 já trata assim. Ler é para todos os papéis — a tela do pré-cadastro
-- mostra o nome do evento em português, e esconder o dicionário faria a tela
-- mostrar o código cru.
--
-- Nenhuma política de escrita, para ninguém — nem admin. O dicionário é a
-- metade nossa de um contrato com a plataforma Komune: mudar uma linha aqui sem
-- mudar o outro lado quebra a tradução, e uma mudança dessas tem de passar por
-- migração, revisada, e não por um PATCH do PostgREST às onze da noite.
--
-- E o privilégio é revogado no braço, não só a política. Sem política de
-- escrita a RLS já barraria — mas aí a tabela só estaria protegida enquanto
-- ninguém acrescentasse uma política de update por engano. Sem o privilégio, o
-- banco recusa antes de olhar a RLS. É o mesmo raciocínio da 20260905000700 com
-- `weekly_reports`.
--
-- O que continua funcionando: `app.komune_aplicar_evento` é `security definer`
-- e roda como o DONO da tabela, que enxerga tudo — a RLS aqui não é `force`, e
-- esta migração não a torna `force` justamente para não cortar esse caminho. O
-- `service_role` do worker também segue lendo e escrevendo: ele é BYPASSRLS.
--
-- ---------------------------------------------------------------------------
-- 2. `public.relatorio_semanal_gerar` deixava `leitura` reescrever o registro
-- ---------------------------------------------------------------------------
-- A migração 20260905000700 (linha 865) guarda a função com `app.sees_all()`:
--
--     if not app.sees_all() then
--       raise exception 'Papel % não tem acesso aos relatórios', app.role() ...
--
-- `app.sees_all()` responde verdadeiro para admin, gestor, sdr, `leitura` e
-- financeiro. Está certo para LER. Só que esta função não lê: ela chama
-- `app.relatorio_semanal_gravar`, que faz `insert ... on conflict (semana_inicio)
-- do update` — sobrescreve os fatos, o texto, a data e o AUTOR do único registro
-- que o CRM guarda daquela semana.
--
-- A mesma migração é explícita sobre isso quatro parágrafos antes, quando
-- retira os privilégios de escrita de `weekly_reports`: "Relatório que alguém
-- pode reescrever pela API não é registro, é rascunho." A tabela ficou fechada;
-- a porta ao lado, não. Pela função definer, `leitura` reescrevia a semana
-- inteira e ficava gravado em `gerado_por_id` como quem pediu.
--
-- A CORREÇÃO. Trocar a guarda por `app.is_manager()` — admin e gestor. Gerar é
-- ato de gestão; ler não é. Ninguém perde a leitura: `public.relatorio_semanal`
-- e `public.relatorios_semanais` continuam com `app.sees_all()`, e é por elas
-- que sdr, `leitura` e financeiro abrem o relatório. Quem some da lista de
-- quem GERA são exatamente os três papéis que não respondem pelo número.
--
-- A função é recriada inteira com `create or replace` porque em plpgsql não há
-- como trocar uma linha do corpo; tudo o mais é cópia fiel do que está lá,
-- inclusive a normalização da semana e a recusa de semana futura. O texto da
-- recusa muda junto: dizer "não tem acesso aos relatórios" para quem acabou de
-- abrir o relatório na tela ao lado é mentira, e manda a pessoa procurar um
-- problema de acesso que ela não tem.
--
-- ---------------------------------------------------------------------------
-- 3. `app.role()` caía em `leitura` — o papel que mais lê dado pessoal
-- ---------------------------------------------------------------------------
-- A migração 20260904000100 (linha 353) devolve `leitura` quando a claim
-- `app_metadata.app_role` falta ou vem com valor fora do enum, e o comentário
-- chama isso de "menor privilégio". A intenção estava certa. O nome do papel é
-- que não confere com o que ele pode.
--
-- Conferindo no próprio código quem é `leitura` (20260904000500, e
-- `app.can_write` refeita pela 20260904001802):
--
--     app.is_admin()        admin                                        → não
--     app.is_manager()      admin, gestor                                → não
--     app.can_write()       admin, gestor, sdr, embaixador, service_role → não
--     app.sees_all()        admin, gestor, sdr, LEITURA, financeiro      → SIM
--     app.reads_base_pii()  admin, gestor, LEITURA, financeiro           → SIM
--
-- `leitura` não escreve, e é só isso que o nome promete. Em compensação ele lê
-- o funil inteiro e lê `organizations`/`contacts` na TABELA BASE — telefone
-- completo, sem máscara. O sdr e o embaixador, que trabalham o dia inteiro no
-- CRM, veem `+55 84 •••••-••12` e precisam de `reveal_phone` (auditado em
-- `pii_access_log`) para ver o número. `leitura` não precisa: para ele o
-- telefone já vem inteiro no `select`.
--
-- Então cair em `leitura` quando o JWT não diz nada não é cair no menor
-- privilégio: é cair no papel que enxerga MAIS dado pessoal de todos, sem
-- deixar rastro em `pii_access_log`. Um token emitido antes do Custom Access
-- Token Hook entrar, uma claim que o hook não conseguiu preencher porque o
-- perfil está inativo, um recorte de sessão em que o `app_metadata` vem vazio —
-- em qualquer um desses a queda entregava a base com telefone.
--
-- A CORREÇÃO. Cair em `bot`, que o enum `app.user_role` já tem (a 20260904000100
-- o acrescentou junto com `financeiro`) e que, conferido nas cinco funções
-- acima, fica FORA DE TODAS. É o único valor do enum com essa propriedade:
-- `financeiro` lê PII, `sdr` e `embaixador` escrevem, `gestor` e `admin` mandam.
-- Papel que não passa em nenhuma guarda é o que "menor privilégio" queria dizer
-- desde o começo.
--
-- `bot` também é o nome certo pelo lado de quem lê o log: a auditoria
-- (20260904000400, linha 234) já assina `bot` a escrita do `service_role`, e a
-- 20260904001802 já documentou que a chave de serviço passa por `app.role()`
-- sem perfil e caía em `leitura` — o que produzia mensagens de erro como "Papel
-- leitura não abre lote de ingestão" para o coletor. Depois desta migração a
-- mensagem diz `bot`, que é a verdade.
--
-- O que NÃO muda com a queda: o worker continua escrevendo, porque
-- `app.can_write()` reconhece o `service_role` por `app.e_o_worker()`, e não
-- pelo papel; e o `service_role` é BYPASSRLS de qualquer forma. Quem perde
-- acesso é só a sessão de navegador cuja claim de papel se perdeu — que é
-- exatamente quem deveria perder, e que resolve saindo e entrando de novo.
-- =====================================================================


-- ---------------------------------------------------------------------------
-- 1. O dicionário do contrato vira catálogo de verdade: lê todo mundo,
--    escreve migração
-- ---------------------------------------------------------------------------
alter table public.komune_event_map enable row level security;

drop policy if exists komune_event_map_select on public.komune_event_map;
create policy komune_event_map_select on public.komune_event_map
  for select to authenticated using (true);

comment on table public.komune_event_map is
  'Tradução do vocabulário da Komune para os eventos de onboarding do R10 §5.2. Evento fora desta tabela é aceito, registrado e ignorado — nunca derruba a entrega. Catálogo: leitura para todo autenticado, escrita só por migração (é a metade nossa de um contrato com a plataforma).';

-- Leitura fica; a escrita sai pelos dois lados (política e privilégio).
grant  select on public.komune_event_map to authenticated, service_role;
revoke insert, update, delete, truncate on public.komune_event_map from authenticated;
revoke all on public.komune_event_map from anon;


-- ---------------------------------------------------------------------------
-- 2. Gerar o relatório da semana é ato de gestão
-- ---------------------------------------------------------------------------
-- Cópia fiel do corpo da 20260905000700, com a guarda trocada e o texto da
-- recusa reescrito para dizer o que fazer.
create or replace function public.relatorio_semanal_gerar(p_semana_inicio date default null)
returns date
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hoje date := (pg_catalog.now() at time zone 'America/Fortaleza')::date;
  v_ini  date;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  -- Gerar reescreve o registro da semana e assina quem pediu. Ler não.
  if not app.is_manager() then
    raise exception 'Gerar o relatório da semana é de admin ou gestor; o papel % abre o relatório já guardado, mas não o reescreve. Peça a um gestor para gerar de novo.', app.role()
      using errcode = '42501';
  end if;

  -- Sem parâmetro, a semana que acabou: é o relatório de segunda.
  v_ini := (pg_catalog.date_trunc('week',
             coalesce(p_semana_inicio, v_hoje - 7)::timestamp))::date;

  if v_ini > v_hoje then
    raise exception 'A semana de % ainda não começou', v_ini using errcode = '22007';
  end if;

  return app.relatorio_semanal_gravar(v_ini, 'manual', auth.uid());
end $$;
comment on function public.relatorio_semanal_gerar(date) is
  'Gera e guarda o relatório de uma semana (RF-REL-09). Sem parâmetro, a semana que acabou. Só admin e gestor: reaplicar SOBRESCREVE o único registro daquela semana e assina quem pediu, então gerar é ato de gestão — ler o relatório continua sendo de quem passa em app.sees_all().';

revoke all on function public.relatorio_semanal_gerar(date) from public, anon;
grant execute on function public.relatorio_semanal_gerar(date) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 3. A queda do papel: DIAGNOSTICADA, NÃO CONSERTADA AQUI
-- ---------------------------------------------------------------------------
-- O defeito é real e continua de pé: sem a claim `app_metadata.app_role`,
-- `app.role()` devolve `leitura` — que passa em `sees_all` e em
-- `reads_base_pii`, ou seja, a queda entrega o funil inteiro e o telefone sem
-- máscara a um token que não soube dizer quem era.
--
-- A correção óbvia — cair em `bot`, o único valor do enum fora das cinco
-- guardas — foi escrita, aplicada num banco criado do zero e REVERTIDA, porque
-- quebra três arquivos de teste e, com eles, caminhos que funcionam hoje:
--
--   15_correcoes_ligacao          asserções 19-20
--   16_esteira_de_ingestao        aborta em `public.origem_dos_dados`
--   26_confirmacao_de_optout_...  asserções 38-39
--
-- A causa é a mesma nos três: um monte de função do produto guarda com
-- `app.org_is_visible`, e nenhum papel que não enxergue a base passa por ali.
-- `bot` não enxerga nada, então "queda segura" vira "queda que derruba".
--
-- O conserto de verdade exige uma das três, e todas são decisão de produto:
--   (a) tirar `reads_base_pii` de `leitura`, e o telefone passa a sair
--       mascarado para o encarregado de LGPD — que é justamente quem precisa
--       dele para responder um pedido de titular;
--   (b) criar um papel novo, visível e sem PII, só para ser a queda;
--   (c) recusar a sessão inteira quando a claim falta, em vez de escolher um
--       papel — o mais honesto, e o que mais quebra se o hook do Supabase
--       oscilar.
--
-- Fica registrado aqui em vez de num cartão perdido: a próxima pessoa que
-- abrir `app.role()` precisa ler isto antes de "só trocar o fallback".

-- A assinatura de relatorio_semanal_gerar não mudou, mas o comentário dela entra
-- na descrição que o PostgREST serve no OpenAPI, e ele guarda um cache do
-- catálogo: sem o aviso, a documentação da API continua anunciando que quem só
-- lê pode gerar.
notify pgrst, 'reload schema';

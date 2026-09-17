-- =====================================================================
-- A triagem do Radar: a fila deixa de ser 277 nomes e vira uma ordem
--
-- =====================================================================
-- O NÚMERO QUE DEFINIU ESTE ARQUIVO
-- =====================================================================
-- Em 17/09/2026 a fila tinha 277 candidatos e UM telefone. Não é falha do
-- coletor: o casamentos.com.br não publica número (esconde atrás de formulário),
-- e o Places, que teria, não pode ser guardado — os Termos proíbem e o R03 §2.4
-- já resolveu isso ("Places é gatilho de descoberta; o dado definitivo vem do
-- fornecedor").
--
-- O pedido original era "filtrar quem tem número de contato". Feito ao pé da
-- letra, ele deixaria 1 candidato na fila: funcionaria e seria inútil. A pergunta
-- que o dado existente responde é outra, e é a que importa: QUAIS DESSES VALEM O
-- TRABALHO DE CAÇAR O TELEFONE?
--
-- =====================================================================
-- O QUE PONTUA, E POR QUE SÓ ISTO
-- =====================================================================
-- O Radar entrega nome, categoria, bairro, cidade e — em 140 dos 277 — a nota e
-- o número de avaliações da fonte. São esses os sinais, e eles já dizem muito:
-- quem tem 4,8 com 60 avaliações é um negócio que existe, atende e é encontrado.
--
-- Os PESOS e os CORTES vivem em `app_settings` (`radar.triagem`), não no código:
-- quem sabe se decoração vale mais que buffet neste mês é quem vende, não quem
-- programa. A tela edita; esta função obedece.
--
-- `score` é 0-100 e `tier` é A+ | A | B | C. As duas colunas já existiam desde o
-- D4 (RF-RAD-12), previstas e nunca preenchidas — e o vocabulário das faixas já
-- estava decidido num CHECK. Inventar "alta/media/baixa" aqui seria criar um
-- segundo idioma para a mesma coisa dentro da mesma tabela.
--
-- =====================================================================
-- O QUE ESTA FUNÇÃO NÃO FAZ
-- =====================================================================
-- Não aprova, não recusa, não esconde ninguém. Ela ORDENA. Candidato de nota
-- baixa continua na fila, e quem quiser revisar os 277 continua podendo — a
-- decisão de quem vira parceiro é humana (RF-RAD-08), e uma pontuação que
-- descarta sozinha seria a IA decidindo pela equipe.
-- =====================================================================

insert into public.app_settings (key, value, description)
values (
  'radar.triagem',
  jsonb_build_object(
    'nota_minima', 4.0,
    'avaliacoes_para_valer', 10,
    'cidades_alvo', jsonb_build_array('Natal', 'Parnamirim', 'Macaíba', 'São Gonçalo do Amarante'),
    'categorias_prioritarias', jsonb_build_array(),
    'pesos', jsonb_build_object('nota', 35, 'avaliacoes', 25, 'categoria', 25, 'cidade', 15),
    'corte_a_mais', 85,
    'corte_a', 65,
    'corte_b', 35
  ),
  'Triagem do Radar (RF-RAD-12): pesos e cortes que ordenam a fila de revisão. Editável pela tela; quem sabe o que vale mais é quem vende.'
)
on conflict (key) do nothing;


-- ---------------------------------------------------------------------------
-- A conta, sobre uma linha de candidato
-- ---------------------------------------------------------------------------
-- Recebe a linha inteira para poder ser chamada do gatilho e do lote sem
-- reconsultar nada. Devolve `{score, tier, porque}` — o `porque` é o que a tela
-- mostra quando alguém pergunta "por que este está no topo?". Pontuação que não
-- se explica é pontuação em que ninguém confia, e a primeira coisa que a equipe
-- faz com ela é ignorar.
create or replace function app.radar_pontuar(p_cand public.supplier_candidates)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_cfg      jsonb;
  v_pesos    jsonb;
  v_score    numeric := 0;
  -- O TETO É O QUE PODE PONTUAR, não a soma de todos os pesos.
  --
  -- Um peso que não pode discriminar ninguém não deve derrubar todo mundo: com
  -- `categorias_prioritarias` vazia (o estado de hoje), os 25 pontos da
  -- categoria não entram para candidato NENHUM, e somá-los ao teto faria o
  -- máximo possível ser 75. A faixa A+ ficaria inalcançável por configuração —
  -- uma régua cujo topo não existe.
  v_max      numeric := 0;
  v_porque   text[] := '{}';
  v_nota_min numeric;
  v_aval_min int;
  v_cidade   text;
begin
  select value into v_cfg from public.app_settings where key = 'radar.triagem';
  if v_cfg is null then
    return jsonb_build_object('score', null, 'tier', null, 'porque', '[]'::jsonb);
  end if;
  v_pesos    := coalesce(v_cfg -> 'pesos', '{}'::jsonb);
  v_nota_min := coalesce((v_cfg ->> 'nota_minima')::numeric, 4.0);
  v_aval_min := coalesce((v_cfg ->> 'avaliacoes_para_valer')::int, 10);

  -- Nota e avaliações sempre participam: a fonte ou as traz, ou não, e nos dois
  -- casos a ausência é informação sobre o candidato.
  v_max := coalesce((v_pesos ->> 'nota')::numeric, 0) + coalesce((v_pesos ->> 'avaliacoes')::numeric, 0);
  if jsonb_array_length(coalesce(v_cfg -> 'categorias_prioritarias', '[]'::jsonb)) > 0 then
    v_max := v_max + coalesce((v_pesos ->> 'categoria')::numeric, 0);
  end if;
  if jsonb_array_length(coalesce(v_cfg -> 'cidades_alvo', '[]'::jsonb)) > 0 then
    v_max := v_max + coalesce((v_pesos ->> 'cidade')::numeric, 0);
  end if;

  -- 1 · A nota da fonte. Só conta acima do mínimo, e cresce até o 5.
  if p_cand.rating is not null and p_cand.rating >= v_nota_min then
    v_score := v_score + coalesce((v_pesos ->> 'nota')::numeric, 0)
               * least(1, (p_cand.rating - v_nota_min) / greatest(0.1, 5 - v_nota_min) + 0.5);
    v_porque := v_porque || format('nota %s na fonte', trim(to_char(p_cand.rating, '9.9')));
  end if;

  -- 2 · Quantas avaliações. Vinte avaliações não valem o dobro de dez: satura.
  if coalesce(p_cand.reviews_count, 0) > 0 then
    v_score := v_score + coalesce((v_pesos ->> 'avaliacoes')::numeric, 0)
               * least(1, p_cand.reviews_count::numeric / greatest(1, v_aval_min));
    v_porque := v_porque || format('%s avaliações', p_cand.reviews_count);
  end if;

  -- 3 · Categoria que a operação elegeu como prioridade neste momento.
  if p_cand.category_id is not null
     and (v_cfg -> 'categorias_prioritarias') @> to_jsonb(p_cand.category_id) then
    v_score := v_score + coalesce((v_pesos ->> 'categoria')::numeric, 0);
    v_porque := v_porque || 'categoria prioritária';
  end if;

  -- 4 · Cidade-alvo. A KOMUNE opera a Grande Natal; fornecedor de outra praça
  --     não é ruim, é para depois.
  select c.name into v_cidade from public.cities c where c.id = p_cand.city_id;
  if v_cidade is not null and (v_cfg -> 'cidades_alvo') @> to_jsonb(v_cidade) then
    v_score := v_score + coalesce((v_pesos ->> 'cidade')::numeric, 0);
    v_porque := v_porque || format('fica em %s', v_cidade);
  end if;

  -- A escala final é sempre 0-100, seja qual for a soma dos pesos que a tela
  -- configurou: assim o corte de A+ significa a mesma coisa depois de alguém
  -- mexer nos pesos.
  v_score := case when v_max > 0 then least(100, greatest(0, round(100 * v_score / v_max))) else 0 end;

  return jsonb_build_object(
    'score', v_score::int,
    'tier', case
              when v_score >= coalesce((v_cfg ->> 'corte_a_mais')::numeric, 85) then 'A+'
              when v_score >= coalesce((v_cfg ->> 'corte_a')::numeric, 65)      then 'A'
              when v_score >= coalesce((v_cfg ->> 'corte_b')::numeric, 35)      then 'B'
              else 'C'
            end,
    'porque', to_jsonb(v_porque));
end $$;

comment on function app.radar_pontuar(public.supplier_candidates) is
  'Pontua um candidato do Radar (0-100) pelos pesos de app_settings radar.triagem e devolve {score, tier, porque}. Ordena, nunca descarta: quem vira parceiro é decisão humana (RF-RAD-08).';


-- ---------------------------------------------------------------------------
-- Repontuar a fila inteira — depois de mudar os pesos, e depois de cada coleta
-- ---------------------------------------------------------------------------
create or replace function public.radar_repontuar()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int := 0;
begin
  if nullif(current_setting('request.jwt.claims', true), '') is not null
     and app.role() not in ('admin'::app.user_role, 'gestor'::app.user_role) then
    raise exception 'Papel % não repontua o Radar', app.role() using errcode = '42501';
  end if;

  with conta as (
    select c.id, app.radar_pontuar(c.*) as p
      from public.supplier_candidates c
     where c.status = 'novo'::app.candidate_status
  )
  update public.supplier_candidates c
     set score = (conta.p ->> 'score')::smallint,
         tier  = conta.p ->> 'tier'
    from conta
   where c.id = conta.id;

  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'candidatos', v_n);
end $$;

comment on function public.radar_repontuar() is
  'Recalcula score e tier de todos os candidatos esperando revisão, com os pesos atuais de radar.triagem. Chamada pela tela quando alguém muda os pesos, e depois de cada coleta. Só admin e gestor.';

revoke all on function public.radar_repontuar() from public, anon;
grant execute on function public.radar_repontuar() to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- Candidato novo já nasce pontuado
-- ---------------------------------------------------------------------------
-- Sem isto, a coleta de segunda-feira entraria sem nota e ficaria no fim da fila
-- por omissão — o pior lugar para um dado novo, porque ninguém desconfia de uma
-- lista ordenada.
create or replace function app.supplier_candidates_pontuar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  v := app.radar_pontuar(new);
  new.score := (v ->> 'score')::smallint;
  new.tier  := v ->> 'tier';
  return new;
end $$;

drop trigger if exists supplier_candidates_pontuar on public.supplier_candidates;
create trigger supplier_candidates_pontuar
  before insert on public.supplier_candidates
  for each row execute function app.supplier_candidates_pontuar();


-- ---------------------------------------------------------------------------
-- Função do schema `app` nasce executável por PUBLIC. Aqui não.
-- ---------------------------------------------------------------------------
-- O teste 09 existe para isto: no Postgres, `create function` concede EXECUTE a
-- PUBLIC por padrão, e `app` é o schema privado. `radar_pontuar` lê `app_settings`
-- e `cities` como definer — deixá-la aberta seria uma porta lateral para o que a
-- RLS governa. A de gatilho não é para ser chamada por ninguém, nunca.
revoke all on function app.radar_pontuar(public.supplier_candidates) from public, anon, authenticated;
revoke all on function app.supplier_candidates_pontuar() from public, anon, authenticated;

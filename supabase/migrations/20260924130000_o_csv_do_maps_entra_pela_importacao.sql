-- =====================================================================
-- O CSV do Google Maps entra pela porta da planilha
--
-- Decisão do Rafael em 24/09/2026 (ADR-12): a lista de prospecção passa a vir
-- de uma raspagem local do Google Maps. O motivo está medido: a fila do Radar
-- tem 277 candidatos e UM telefone. Não é defeito do coletor — o
-- casamentos.com.br não publica o número (fica atrás de um endpoint em
-- Disallow), e nenhuma das outras fontes lidas em 17/09 publica o telefone e
-- permite a coleta ao mesmo tempo. O CRM inteiro começa numa mensagem; uma
-- fila bem ordenada de gente que não dá para chamar não vira conversa nenhuma.
--
-- POR QUE ESTA MIGRAÇÃO EXISTE, E POR QUE ELA É PEQUENA
-- Não se constrói caminho novo de escrita: o CSV entra pela importação de
-- planilha, que já é a esteira do ADR-08 (raw_capture → source_record →
-- supplier_candidate → revisão → organizations), com prévia, dedup e desfazer
-- de 48 h. O que se conserta aqui é um ESTREITAMENTO: o payload que
-- `app.importacao_normalizar` monta tem 9 campos (`20260904001820:531-540`) e a
-- whitelist do R06 (`app.payload_e_permitido`, `20260904001600:141`) permite 22.
-- `email`, `endereco`, `cep`, `nota`, `avaliacoes_qtd` e `place_id` já têm
-- coluna em `public.source_record` e eram jogados fora na porta de entrada.
--
-- O que esta migração ENTREGA
--   1. `app.endereco_br(text)`: o endereço de uma linha do Maps, que vem numa
--      coluna só, vira {bairro, cidade, cep}. Nulo onde não casou.
-- =====================================================================

-- ---------------------------------------------------------------------------
-- 1. Um endereço do Maps vira bairro, cidade e CEP
-- ---------------------------------------------------------------------------
-- O kit devolve o endereço inteiro numa coluna:
--   "Av. Eng. Roberto Freire, 1234 - Capim Macio, Natal - RN, 59082-095"
-- e o CRM precisa dos três separados: `cidade` alimenta `app.importacao_cidade`
-- (e a rota de visita), `bairro` alimenta a rota e a dedup de telefone fixo, e
-- `cep` para em `source_record` — não existe coluna de CEP em
-- `supplier_candidates` nem em `organizations`, e nesta fase não criamos uma.
--
-- A REGRA É ESTREITA DE PROPÓSITO, e o que não casou volta NULO. O Google não
-- garante formato nenhum: MEI que atende em casa, endereço sem número,
-- rodovia, ponto de referência. Palpitar bairro aqui não estraga a ficha —
-- estraga a visita de quem for até lá com a rota na mão.
create or replace function app.endereco_br(t text)
returns jsonb
language plpgsql
-- `stable`, e não `immutable`: `jsonb_build_object` é STABLE no Postgres (a
-- conversão de um valor para json pode depender de configuração da sessão), e
-- `plpgsql_check` acusa a mentira. Nada aqui precisa de `immutable`: a função
-- não entra em índice nem em coluna gerada, e quem a chama
-- (`app.importacao_normalizar`) também é `stable`.
stable
set search_path = ''
as $$
declare
  v_txt    text := coalesce(t, '');
  v_bruto  text;
  v_digito text;
  v_cep    text;
  v_partes text[];
  v_qual   int;      -- índice do pedaço que é a cidade
  v_cidade text;
  v_bairro text;
begin
  -- (a) CEP: a PRIMEIRA ocorrência de \d{5}-?\d{3}, sempre devolvida NNNNN-NNN.
  v_bruto := (select x[1] from regexp_matches(v_txt, '(\d{5}-?\d{3})') x limit 1);
  if v_bruto is not null then
    v_digito := replace(v_bruto, '-', '');
    v_cep    := substr(v_digito, 1, 5) || '-' || substr(v_digito, 6, 3);
    -- Tirado o CEP, o que sobra é o endereço. O espaço no lugar evita colar
    -- dois pedaços que eram vizinhos do número.
    v_txt := replace(v_txt, v_bruto, ' ');
  end if;

  -- (b) Cidade: o ÚLTIMO pedaço entre vírgulas que termine em "- UF".
  v_partes := string_to_array(v_txt, ',');
  for v_i in 1 .. coalesce(array_length(v_partes, 1), 0) loop
    if v_partes[v_i] ~ '^\s*(.+?)\s*-\s*[A-Z]{2}\s*$' then
      v_qual := v_i;
    end if;
  end loop;
  if v_qual is not null then
    v_cidade := (regexp_match(v_partes[v_qual], '^\s*(.+?)\s*-\s*[A-Z]{2}\s*$'))[1];
  end if;

  -- (c) Bairro: o que vem depois do último " - " no pedaço IMEDIATAMENTE
  -- anterior ao da cidade. Sem " - " ali, não há bairro — e não se inventa um.
  if v_qual is not null and v_qual > 1
     and position(' - ' in v_partes[v_qual - 1]) > 0 then
    v_bairro := nullif(trim(regexp_replace(v_partes[v_qual - 1], '^.* - ', '')), '');
  end if;

  return jsonb_build_object('bairro', v_bairro, 'cidade', v_cidade, 'cep', v_cep);
end $$;
comment on function app.endereco_br(text) is
  'Endereço de uma linha do Google Maps → {bairro, cidade, cep}. CEP normalizado em NNNNN-NNN; cidade do último pedaço "Nome - UF"; bairro depois do último " - " do pedaço anterior ao da cidade. O que não casou volta NULO: aqui não se palpita.';
revoke all on function app.endereco_br(text) from public, anon;
grant execute on function app.endereco_br(text) to authenticated, service_role;

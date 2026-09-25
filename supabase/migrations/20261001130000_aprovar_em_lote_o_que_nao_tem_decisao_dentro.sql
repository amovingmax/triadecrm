-- =====================================================================
-- Aprovar em lote o que não tem decisão dentro
--
-- POR QUÊ (desenho de 25/09/2026, §1(e), item 7 da tabela de esforço;
-- docs/superpowers/specs/2026-09-25-importar-sem-fila-design.md): em 25/09 a
-- fila tinha 155 candidatos presos, quase todos por um nome de categoria que o
-- CRM não conhecia. Resolver um a um são três cliques por nome — abrir a
-- decisão, escolher entre 19 categorias, confirmar — vezes 155. Uma fila de 12
-- é trabalhada no mesmo dia; uma de 155 é ignorada, e aí as duplicatas de
-- verdade morrem junto com o ruído.
--
-- A TRAVA QUE FAZ ISTO SER SEGURO É NÃO HAVER CAMINHO NOVO DE ESCRITA.
-- `public.radar_revisar_lote` é um laço sobre `public.radar_revisar_candidato`
-- — a MESMA função que o cartão chama hoje —, e não sobre
-- `app.promover_candidato` direto. É ela que guarda:
--   · o `app.can_write()` e o `auth.uid()`;
--   · a recusa de candidato `do_not_contact` (RF-RAD-09);
--   · a máscara da ficha de carteira alheia.
-- E `app.promover_candidato`, dentro do laço, reconfere a lista de supressão
-- VIVA a cada candidato — quem pediu para sair depois de ser coletado não vira
-- ficha, nem no lote. Uma entrada de `audit_log` por candidato, como sempre.
--
-- O QUE NÃO ENTRA NO LOTE, E POR QUÊ:
--   · duplicata e mesclar — a decisão é QUAL FICHA VENCE, e isso não se agrupa;
--   · "não contatar" — escreve em `suppression_list` e em `consent_events`;
--     nunca em lote;
--   · "recusar" — o banco exige motivo escrito
--     (`supplier_candidates_recusa_com_motivo`), e motivo em lote seria motivo
--     genérico, que é o mesmo que motivo nenhum.
--
-- SUBTRANSAÇÃO POR CANDIDATO: sem o bloco `exception`, um único candidato que
-- estourasse levaria os outros 199 junto, e quem apertou não saberia qual foi.
-- Com ela, o lote continua e o relatório nomeia o que passou e o que não.
-- =====================================================================

create or replace function public.radar_revisar_lote(
  p_ids         uuid[],
  p_category_id int default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_id     uuid;
  v_res    jsonb;
  v_ok     int  := 0;
  v_falhou int  := 0;
  v_itens  jsonb := '[]'::jsonb;
  v_vistos uuid[] := '{}'::uuid[];
begin
  -- A checagem também está em `radar_revisar_candidato`, e é de propósito:
  -- recusar cedo evita abrir 200 subtransações para reprovar 200 vezes.
  if v_uid is null or not app.can_write() then
    raise exception 'Papel % não revisa a fila do Radar', app.role() using errcode = '42501';
  end if;
  if p_ids is null or cardinality(p_ids) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'lote_vazio');
  end if;
  -- Teto de 200: acima disso a chamada deixa de caber no clique de uma pessoa,
  -- e um lote que estoura no meio é pior que dois lotes que terminam.
  if cardinality(p_ids) > 200 then
    return jsonb_build_object('ok', false, 'reason', 'lote_grande_demais');
  end if;
  if p_category_id is not null
     and not exists (select 1 from public.categories c
                      where c.id = p_category_id and c.is_active) then
    return jsonb_build_object('ok', false, 'reason', 'categoria_inexistente');
  end if;

  foreach v_id in array p_ids loop
    -- O mesmo id duas vezes na seleção não é dois trabalhos: a segunda volta
    -- responderia 'ja_revisado' e inflaria a conta de falhas com um erro que
    -- não existe.
    if v_id = any (v_vistos) then
      continue;
    end if;
    v_vistos := v_vistos || v_id;

    begin
      v_res := public.radar_revisar_candidato(v_id, 'aprovar', null, p_category_id, null);
    exception when others then
      -- A subtransação desfaz SÓ este candidato. O `sqlerrm` vai para o
      -- relatório: sem ele, "3 não passaram" não diz o que fazer a seguir.
      v_res := jsonb_build_object('ok', false, 'reason', 'erro', 'detalhe', sqlerrm);
    end;

    if coalesce((v_res ->> 'ok')::boolean, false) then
      v_ok := v_ok + 1;
    else
      v_falhou := v_falhou + 1;
    end if;

    v_itens := v_itens || jsonb_build_array(jsonb_build_object(
      'candidate_id', v_id,
      'ok',           coalesce((v_res ->> 'ok')::boolean, false),
      'reason',       v_res ->> 'reason',
      'nome',         (select c.name from public.supplier_candidates c where c.id = v_id),
      'organization_id', v_res ->> 'organization_id'));
  end loop;

  return jsonb_build_object('ok', true, 'aprovados', v_ok, 'recusados', v_falhou,
                            'itens', v_itens);
end $$;
comment on function public.radar_revisar_lote(uuid[], int) is
  'Aprova em lote os candidatos que não têm decisão dentro (RF-RAD-11). Laço sobre public.radar_revisar_candidato — o MESMO caminho do cartão, com o can_write(), a recusa de do_not_contact e a máscara de carteira alheia —, com subtransação por candidato e teto de 200. Mesclar, "não contatar" e "recusar" continuam um a um, com motivo escrito. Devolve a conta e o motivo de cada um que não passou.';
revoke all on function public.radar_revisar_lote(uuid[], int) from public, anon;
grant execute on function public.radar_revisar_lote(uuid[], int) to authenticated;

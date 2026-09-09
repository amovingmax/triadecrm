-- =====================================================================
-- 20260909150000 — O "não contatar" do Radar suprime de verdade
--                  (RF-RAD-09, RF-ADM-04; guardrail de opt-out do produto)
--
-- ---------------------------------------------------------------------------
-- O DEFEITO
-- ---------------------------------------------------------------------------
-- Na fila de revisão do Radar, a ação `nao_contatar` de
-- `public.radar_revisar_candidato` só marcava a coluna `do_not_contact` DAQUELA
-- LINHA de `supplier_candidates`. Nada mais. Nenhum hash entrava em
-- `suppression_list`, nenhum `consent_event` era registrado.
--
-- O guardrail central do produto — "nenhum envio a contato suprimido, em nenhum
-- modo" — mora na `suppression_list`, porque é ela que `app.is_suppressed` lê e
-- é `app.is_suppressed` que todo caminho de envio, cadência, tarefa e ingestão
-- consulta. Marcar a linha do candidato protege exatamente uma linha, e o pedido
-- da pessoa morre com ela:
--
--   * dez minutos depois alguém cadastra o mesmo telefone em Parceiros pelo
--     cadastro rápido (`public.quick_create_organization`), que só recusa número
--     que está na lista de supressão — este não estava. Nasce ficha, nasce
--     negócio, nasce cadência, e o primeiro contato sai;
--   * a coleta seguinte traz o mesmo alvo pela mesma fonte com outro
--     `external_id` (ou por outra fonte), e o candidato novo nasce limpo: o
--     gatilho `app.supplier_candidates_normalize` também decide "não contatar"
--     olhando a `suppression_list`, que continuava vazia.
--
-- Quem revisou a fila clicou em "não contatar" achando que estava cumprindo o
-- pedido de alguém. Não estava.
--
-- ---------------------------------------------------------------------------
-- A CORREÇÃO, E POR QUE É ESTA
-- ---------------------------------------------------------------------------
-- O caminho certo já existe e já é usado pela importação de planilha
-- (`public.importacao_gravar`, migração 20260904001820): quando a linha diz que
-- a pessoa pediu para parar, o telefone e o @ vão para a lista de supressão por
-- `app.suppress`, e — se já existe ficha — o pedido vira um `contact_optout` em
-- `consent_events`, deixando `app.consent_apply` fazer o resto (do_not_contact
-- na ficha e nas pessoas, hashes na lista, negócio aberto movido para a etapa de
-- opt-out do funil). Este é o mesmo pedido, pelo mesmo motivo, então é o mesmo
-- caminho: nada de uma segunda maneira de suprimir, com regras próprias.
--
-- Uma diferença deliberada em relação à importação, que usa um ou outro: aqui o
-- telefone e o @ DO CANDIDATO entram na lista sempre, e o `consent_event` é um
-- acréscimo quando existe ficha correspondente. O motivo é que a ficha pode ter
-- sido encontrada pelo @ ou pelo CNPJ e carregar OUTRO telefone — o número que o
-- candidato mostrou é o que a próxima coleta vai trazer de volta, e é ele que
-- precisa estar hasheado para o candidato novo já nascer "não contatar". Quando
-- há ficha, a supressão nasce apontando para o evento de consentimento
-- (`source_event_id`), para que a prova e o hash fiquem ligados.
--
-- O CNPJ fica de fora de propósito: suprimir CNPJ é bloquear a empresa inteira e
-- só acontece em pedido de eliminação (`app.consent_apply` o faz apenas em
-- `erasure_*`). "Não contatar" é sobre não procurar aquele contato.
--
-- Fora isso, nada muda: mesma assinatura, mesmos retornos, mesmas checagens de
-- papel e de carteira, mesma tela. A recusa simples (`recusar`) continua sem
-- suprimir ninguém — recusar é "não serve para nós", e não "não me procure".
-- =====================================================================

create or replace function public.radar_revisar_candidato(
  p_candidate_id   uuid,
  p_acao           text,
  p_organization_id uuid default null,
  p_category_id    int  default null,
  p_reason         text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_c      public.supplier_candidates;
  v_res    jsonb;
  v_org    uuid;
  v_evento uuid;
  v_motivo text;
begin
  if v_uid is null or not app.can_write() then
    raise exception 'Papel % não revisa a fila do Radar', app.role() using errcode = '42501';
  end if;

  select * into v_c from public.supplier_candidates where id = p_candidate_id;
  if v_c.id is null then
    return jsonb_build_object('ok', false, 'reason', 'candidato_inexistente');
  end if;
  if v_c.status <> 'novo' then
    return jsonb_build_object('ok', false, 'reason', 'ja_revisado', 'status', v_c.status);
  end if;

  -- ---------------- recusar / não contatar ----------------
  if p_acao in ('recusar', 'nao_contatar') then
    v_res := app.recusar_candidato(p_candidate_id, p_reason, p_acao = 'nao_contatar');

    -- A supressão vem DEPOIS e só se a recusa passou: `app.recusar_candidato`
    -- exige motivo escrito, e suprimir um telefone por um clique que a própria
    -- função recusou seria bloquear alguém sem decisão registrada.
    if p_acao = 'nao_contatar' and coalesce((v_res ->> 'ok')::boolean, false) then
      v_motivo := concat_ws(' — ', 'Radar: não contatar',
                            nullif(trim(coalesce(p_reason, '')), ''));

      -- A ficha já existe? Então o pedido é prova e tem de virar `consent_event`:
      -- é o que move o negócio para a etapa de opt-out e marca a ficha e as
      -- pessoas dela. Suprimir por fora deixaria o cartão em "Em conversa", na
      -- fila do dia de alguém que não pode mais escrever.
      select o.id into v_org
        from public.organizations o
       where o.deleted_at is null
         and ((v_c.phone_e164       is not null and o.phone_e164       = v_c.phone_e164)
           or (v_c.instagram_handle is not null and o.instagram_handle = v_c.instagram_handle)
           or (v_c.cnpj             is not null and o.cnpj             = v_c.cnpj))
       limit 1;

      if v_org is not null then
        insert into public.consent_events
          (kind, organization_id, channel, evidence_text, occurred_at, recorded_by)
        values
          ('contact_optout'::app.consent_kind, v_org, 'whatsapp'::app.channel,
           v_motivo, now(), v_uid)
        returning id into v_evento;
      end if;

      -- Sempre: o número e o @ que o candidato mostrou. Sem ficha, o hash é o
      -- mínimo que cumpre o pedido e o máximo que a minimização permite; com
      -- ficha, ele cobre o contato do candidato quando a ficha foi encontrada
      -- pelo @ ou pelo CNPJ e tem outro telefone.
      perform app.suppress('phone', v_c.phone_e164, v_motivo,
                           'whatsapp'::app.channel, v_evento);
      perform app.suppress('instagram', v_c.instagram_handle, v_motivo,
                           'instagram'::app.channel, v_evento);
    end if;

    return v_res;
  end if;

  if p_acao not in ('aprovar', 'mesclar') then
    return jsonb_build_object('ok', false, 'reason', 'acao_invalida');
  end if;

  -- Um candidato marcado "não contatar" (supressão, RF-RAD-09) não vira alvo.
  if v_c.do_not_contact then
    return jsonb_build_object('ok', false, 'reason', 'candidato_nao_contatar');
  end if;

  -- ---------------- mesclar com ficha existente ----------------
  if p_acao = 'mesclar' then
    if p_organization_id is null then
      return jsonb_build_object('ok', false, 'reason', 'organizacao_obrigatoria');
    end if;
    if not exists (select 1 from public.organizations o
                    where o.id = p_organization_id and o.deleted_at is null) then
      return jsonb_build_object('ok', false, 'reason', 'organizacao_inexistente');
    end if;
    -- Regra de carteira: só quem pode editar a ficha pode receber dado nela.
    if not app.org_is_editable(p_organization_id) then
      return jsonb_build_object('ok', false, 'reason', 'organizacao_fora_da_carteira');
    end if;
    return app.mesclar_candidato(p_candidate_id, p_organization_id, p_category_id,
                                 p_reason, v_c.import_batch_id);
  end if;

  -- ---------------- aprovar ----------------
  v_res := app.promover_candidato(p_candidate_id, null, v_uid, null, null,
                                  p_category_id, v_c.import_batch_id);

  -- A ficha suspeita existe, mas pode ser de carteira alheia: o id só sai daqui
  -- para quem já poderia abri-la. Quem não pode continua sabendo que existe.
  if coalesce((v_res ->> 'ok')::boolean, false) = false
     and v_res ->> 'reason' = 'ja_existe_na_base' then
    v_org := (v_res ->> 'organization_id')::uuid;
    return jsonb_build_object('ok', false, 'reason', 'ja_existe_na_base',
                              'organization_id',
                              case when app.org_is_visible(v_org) then v_org end);
  end if;

  if coalesce((v_res ->> 'ok')::boolean, false) and nullif(trim(coalesce(p_reason, '')), '') is not null then
    update public.supplier_candidates set review_reason = trim(p_reason) where id = p_candidate_id;
  end if;

  return v_res;
end $$;

comment on function public.radar_revisar_candidato(uuid,text,uuid,int,text) is
  'Decisão da fila do Radar (RF-RAD-11). Despachante fino sobre app.recusar_candidato, app.mesclar_candidato e app.promover_candidato — as mesmas funções que o worker chama (ADR-08, caminho único de escrita). As checagens de papel e de carteira ficam aqui, porque dependem do JWT. Desde a migração 20260909150000, "não contatar" também coloca o telefone e o @ na suppression_list e, quando já existe ficha, registra o contact_optout em consent_events (RF-RAD-09, RF-ADM-04).';

revoke all on function public.radar_revisar_candidato(uuid,text,uuid,int,text) from public;
grant execute on function public.radar_revisar_candidato(uuid,text,uuid,int,text) to authenticated;

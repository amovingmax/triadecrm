-- ===========================================================================
-- O aceite se ajusta ao que a tabela aceita, e nunca derruba o evento
-- ===========================================================================
--
-- Correção da `20260910160000`, pega ao exercitar o gatilho contra a produção
-- antes de deixá-lo esperando o primeiro fornecedor de verdade.
--
-- DOIS DEFEITOS, e o segundo é o grave.
--
-- 1. `auth_method` tem CHECK com lista fechada — `claim_link`, `otp_whatsapp`,
--    `otp_sms`, `email_code`, `cs_manual` — e eu inventei `komune_onboarding`.
--    O valor certo é `claim_link`: a pessoa chegou pelo link de reivindicação,
--    que é literalmente o que aconteceu. As outras colunas também têm faixa:
--    `terms_hash` exige SHA-256 de verdade (`^[0-9a-f]{64}$`), `user_agent`
--    entre 5 e 400 caracteres, `who_accepted` entre 2 e 120, `terms_version`
--    entre 1 e 40.
--
-- 2. **Um aceite fora de faixa derrubava o evento inteiro.** O gatilho é
--    `after insert` na mesma transação do `pre_registration_events`, então a
--    exceção do CHECK abortava o insert do evento junto — e com ele o
--    processamento do webhook. Um `user_agent` de 4 letras vindo da Komune
--    apagaria o registro de que a reivindicação aconteceu.
--
--    Isso inverte a prioridade. O evento é o fato; o aceite é o detalhe. Perder
--    o detalhe é ruim, perder o fato é pior — e o CRM ficaria sem saber que o
--    fornecedor reivindicou o perfil.
--
-- A partir daqui o gatilho SANEIA o que dá e DESISTE do que não dá, sempre sem
-- levar o evento junto. O que ele não pode fazer é gravar aceite falso: sem
-- `terms_version`, não há como dizer qual texto a pessoa leu, e uma linha de
-- prova sem isso não prova nada — então ela não nasce.
--
-- SOBRE O `terms_hash` VIR NULO. O hash existia porque a página de
-- reivindicação do próprio CRM renderizava o texto e podia hashear exatamente
-- os bytes que a pessoa viu. O wizard da Komune não renderiza: ele LINKA para
-- komune.app.br/termos. Não há texto local para hashear, e inventar um hash de
-- alguma coisa seria pior que a ausência — daria aparência de prova onde só há
-- a versão. Fica a versão, que identifica a redação, e o hash nulo. O CHECK do
-- banco aceita nulo e recusa lixo, que é exatamente o comportamento desejado.
-- ===========================================================================

create or replace function app.aceite_do_claimed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_aceite  jsonb := new.payload -> 'aceite';
  v_versao  text;
  v_hash    text;
  v_agente  text;
  v_quem    text;
begin
  if new.event is distinct from 'claimed' or v_aceite is null then
    return null;
  end if;

  if coalesce((v_aceite ->> 'terms_accepted')::boolean, false) is not true
     or coalesce((v_aceite ->> 'data_authorization')::boolean, false) is not true then
    return null;
  end if;

  -- Cada campo é aparado para a faixa do CHECK, ou vira nulo. Nulo passa nos
  -- CHECKs de tamanho (comparação com nulo é nulo, e nulo não reprova) e diz a
  -- verdade: "não temos isto", em vez de um valor inventado para caber.
  v_versao := nullif(btrim(coalesce(v_aceite ->> 'terms_version', '')), '');
  if v_versao is not null and length(v_versao) > 40 then
    v_versao := left(v_versao, 40);
  end if;

  -- Só um SHA-256 de verdade entra. Qualquer outra coisa é nulo.
  v_hash := lower(nullif(btrim(coalesce(v_aceite ->> 'terms_hash', '')), ''));
  if v_hash !~ '^[0-9a-f]{64}$' then
    v_hash := null;
  end if;

  v_agente := nullif(btrim(coalesce(v_aceite ->> 'user_agent', '')), '');
  if v_agente is not null and (length(v_agente) < 5 or length(v_agente) > 400) then
    v_agente := case when length(v_agente) > 400 then left(v_agente, 400) else null end;
  end if;

  v_quem := nullif(btrim(coalesce(v_aceite ->> 'who_accepted', '')), '');
  if v_quem is not null and (length(v_quem) < 2 or length(v_quem) > 120) then
    v_quem := case when length(v_quem) > 120 then left(v_quem, 120) else null end;
  end if;

  -- Sem versão não há prova: não dá para dizer QUAL texto a pessoa aceitou, e
  -- uma linha de consentimento que não identifica a redação é pior que a
  -- ausência dela, porque parece prova.
  if v_versao is null then
    return null;
  end if;

  if exists (
    select 1 from public.pre_registration_acceptances a
     where a.pre_registration_id = new.pre_registration_id
       and a.terms_version is not distinct from v_versao
  ) then
    return null;
  end if;

  -- A rede de baixo. Nada aqui pode derrubar o insert do EVENTO, que é o fato;
  -- o aceite é o detalhe. Se um CHECK novo aparecer amanhã e esta função não
  -- souber dele, o CRM perde o registro do aceite e mantém o da reivindicação
  -- — e o aviso fica no log, não no silêncio.
  begin
    insert into public.pre_registration_acceptances (
      pre_registration_id, organization_id,
      terms_version, terms_hash, terms_accepted, data_authorization,
      marketing_optin, photo_import_authorized,
      accepted_at, ip, user_agent, auth_method, who_accepted
    ) values (
      new.pre_registration_id,
      new.organization_id,
      v_versao,
      v_hash,
      true,
      true,
      coalesce((v_aceite ->> 'marketing_optin')::boolean, false),
      false,
      coalesce(nullif(v_aceite ->> 'accepted_at', '')::timestamptz, new.occurred_at, now()),
      (select case when nullif(v_aceite ->> 'ip', '') ~ '^[0-9a-fA-F:.]+$'
                   then (v_aceite ->> 'ip')::inet end),
      v_agente,
      -- A pessoa chegou pelo link de reivindicação. É um dos cinco valores que
      -- o CHECK admite, e é o que descreve o caminho real.
      'claim_link',
      v_quem
    );
  exception when others then
    raise warning 'aceite_do_claimed: não gravei o aceite do rascunho % (%): %',
      new.pre_registration_id, sqlstate, sqlerrm;
  end;

  return null;
end $$;

comment on function app.aceite_do_claimed() is
  'Transforma o objeto `aceite` do evento supplier.claimed numa linha de pre_registration_acceptances (R06 PRE-07). Saneia cada campo para a faixa do CHECK e NUNCA derruba o insert do evento: o evento é o fato, o aceite é o detalhe. Sem `terms_version` não grava — prova que não identifica a redação não é prova.';

-- O índice da 20260910160000 era por (rascunho, hash), e o hash agora costuma
-- ser nulo. A idempotência passou a ser por versão, e o índice acompanha.
drop index if exists public.pre_registration_acceptances_por_rascunho;
create index if not exists pre_registration_acceptances_por_rascunho
  on public.pre_registration_acceptances (pre_registration_id, terms_version);
